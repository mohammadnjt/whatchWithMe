import { useState, useEffect, useRef, useCallback } from 'react';
import { RoomState, Participant, ChatMessage, MovieInfo } from '../types';

interface UseWatchTogetherSyncOptions {
  roomId: string;
  user: {
    id: string;
    name: string;
    avatar: string;
    quality: string;
    role?: 'admin' | 'user';
  };
  onNewPendingUser?: (user: any) => void;
}

/** Remembers the mic preference across reloads and rooms. */
const OPEN_MIC_KEY = 'watchtogether_open_mic';

/** How long an incoming-message banner stays on screen. */
const CHAT_NOTIFICATION_MS = 6000;

/** A banner for a message someone else just sent. */
export interface ChatNotification {
  id: string;
  senderName: string;
  avatar: string;
  text: string;
}

/**
 * One peer in the voice mesh.
 *
 * `sender` is created up front from a sendrecv transceiver with no track, so
 * turning the microphone on later is a `replaceTrack` call that needs no
 * renegotiation, and push-to-talk is just toggling `track.enabled`.
 *
 * `polite` implements the perfect-negotiation tie-break: when both sides offer
 * at once the polite peer rolls back and accepts the other's offer. The two ends
 * must disagree, so it is derived from comparing the two user ids.
 */
interface PeerConn {
  pc: RTCPeerConnection;
  sender: RTCRtpSender | null;
  audio: HTMLAudioElement;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
}

export function useWatchTogetherSync({ roomId, user, onNewPendingUser }: UseWatchTogetherSyncOptions) {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [latencyMs, setLatencyMs] = useState<number>(12);
  const [serverTimeOffset, setServerTimeOffset] = useState<number>(0);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [toastNotification, setToastNotification] = useState<{ text: string; variant?: string } | null>(null);
  // Banners for messages from other people, newest last. Kept separate from the
  // generic toast so several can stack and each can show who sent it.
  const [chatNotifications, setChatNotifications] = useState<ChatNotification[]>([]);
  // Bumped whenever the subtitle list of the current video changes anywhere, so
  // the player can refetch it. Subtitles live on the server, not in room state.
  const [subtitlesVersion, setSubtitlesVersion] = useState<number>(0);

  // Live Voice Chat States
  const [isMicActive, setIsMicActive] = useState<boolean>(false);
  const [isPushToTalkActive, setIsPushToTalkActive] = useState<boolean>(false);
  const [isLocalSpeaking, setIsLocalSpeaking] = useState<boolean>(false);
  const [speakingUserIds, setSpeakingUserIds] = useState<Set<string>>(new Set());
  const [locallyMutedUserIds, setLocallyMutedUserIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('watchtogether_muted_users');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });

  // Open mic: keep the microphone live for the whole session instead of holding M.
  const [isOpenMic, setIsOpenMic] = useState<boolean>(() => {
    try {
      return localStorage.getItem(OPEN_MIC_KEY) === 'true';
    } catch {
      return false;
    }
  });
  // Set when the browser refuses to autoplay incoming voice until the page is clicked.
  const [isVoiceBlocked, setIsVoiceBlocked] = useState<boolean>(false);
  // Connection state per voice peer, so a failure to connect is visible instead
  // of looking exactly like a working microphone that nobody can hear.
  const [voicePeerStates, setVoicePeerStates] = useState<Record<string, RTCPeerConnectionState>>({});
  // Set when this account is signed in more than once: those sessions are one
  // participant and cannot carry voice between them.
  const [duplicateSession, setDuplicateSession] = useState<string | null>(null);

  const isMicActiveRef = useRef<boolean>(false);
  const isPTTHeldRef = useRef<boolean>(false);
  const isPttTriggeredRef = useRef<boolean>(false);
  const isOpenMicRef = useRef<boolean>(isOpenMic);

  const socketRef = useRef<WebSocket | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const isRemoteActionRef = useRef<boolean>(false);
  const toastTimeoutRef = useRef<any>(null);

  // Microphone capture and local voice-activity detection
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const vadAnimationRef = useRef<number | null>(null);
  const isSpeakingRef = useRef<boolean>(false);
  const locallyMutedUserIdsRef = useRef<Set<string>>(locallyMutedUserIds);
  const userRef = useRef(user);
  const onNewPendingUserRef = useRef(onNewPendingUser);

  // WebRTC voice mesh. Audio travels peer-to-peer (or via TURN); the WebSocket
  // only carries the handshake. One RTCPeerConnection per other participant.
  const myIdRef = useRef<string>(user.id);
  const peersRef = useRef<Map<string, PeerConn>>(new Map());
  const iceServersRef = useRef<RTCIceServer[]>([]);
  const iceReadyRef = useRef<Promise<void> | null>(null);
  // Held in a ref so the socket effect never has to re-run when it changes.
  const handleSignalRef = useRef<((s: string, k: string, p: any) => void) | null>(null);

  // Keep refs in sync with props without causing socket reconnects
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    onNewPendingUserRef.current = onNewPendingUser;
  }, [onNewPendingUser]);

  // Update ref whenever state changes
  useEffect(() => {
    locallyMutedUserIdsRef.current = locallyMutedUserIds;
    try {
      localStorage.setItem('watchtogether_muted_users', JSON.stringify(Array.from(locallyMutedUserIds)));
    } catch {
      // ignore
    }
  }, [locallyMutedUserIds]);

  const showToast = useCallback((text: string, variant: string = 'info') => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastNotification({ text, variant });
    toastTimeoutRef.current = setTimeout(() => {
      setToastNotification(null);
    }, 3500);
  }, []);

  // Initialize and maintain WebSocket connection
  useEffect(() => {
    if (!roomId) {
      setIsConnected(false);
      return;
    }

    let ws: WebSocket;
    let pingInterval: any;
    let reconnectTimeout: any;
    let isDisposed = false;

    function connect() {
      if (isDisposed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;

      try {
        ws = new WebSocket(wsUrl);
        socketRef.current = ws;

        ws.onopen = () => {
          setIsConnected(true);
          // Send join message with latest user info
          ws.send(
            JSON.stringify({
              type: 'join',
              roomId,
              user: userRef.current,
            })
          );

          // Start NTP-style ping routine every 2.5s for ultra-accurate clock sync
          pingInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: 'ping',
                  clientTimestamp: Date.now(),
                })
              );
            }
          }, 2500);
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            if (data.type === 'pong') {
              const now = Date.now();
              const rtt = Math.max(2, now - data.clientTimestamp);
              const calculatedLatency = Math.round(rtt / 2);
              setLatencyMs(calculatedLatency);
              const offset = data.serverTimestamp + calculatedLatency - now;
              setServerTimeOffset(offset);
              return;
            }

            if (data.type === 'room:init') {
              // Our server-side id decides which side of each WebRTC pair offers.
              if (data.yourId) myIdRef.current = data.yourId;
              setRoom(data.room);
              setParticipants(data.room.participants);
              setChatMessages(data.room.chatMessages);

              // Apply initial video position
              if (videoRef.current && data.room.currentTime > 0) {
                isRemoteActionRef.current = true;
                videoRef.current.currentTime = data.room.currentTime;
                if (data.room.isPlaying) {
                  videoRef.current.play().catch(() => {});
                } else {
                  videoRef.current.pause();
                }
                setTimeout(() => {
                  isRemoteActionRef.current = false;
                }, 400);
              }
              return;
            }

            if (data.type === 'video:sync') {
              setRoom((prev) => (prev ? {
                ...prev,
                currentTime: data.currentTime,
                isPlaying: data.isPlaying,
                playbackRate: data.playbackRate,
                lastUpdatedServerTime: data.lastUpdatedServerTime,
                status: data.isPlaying ? 'playing' : 'paused',
              } : null));

              if (videoRef.current) {
                isRemoteActionRef.current = true;
                const targetTime = data.currentTime;
                const currentTime = videoRef.current.currentTime;

                if (Math.abs(currentTime - targetTime) > 0.3) {
                  videoRef.current.currentTime = targetTime;
                }

                if (data.isPlaying && videoRef.current.paused) {
                  videoRef.current.play().catch(() => {});
                } else if (!data.isPlaying && !videoRef.current.paused) {
                  videoRef.current.pause();
                }

                if (data.playbackRate && videoRef.current.playbackRate !== data.playbackRate) {
                  videoRef.current.playbackRate = data.playbackRate;
                }

                setTimeout(() => {
                  isRemoteActionRef.current = false;
                }, 400);
              }

              if (data.actionBy && data.actionBy !== user.name) {
                const actionLabel =
                  data.actionType === 'play'
                    ? 'started playing'
                    : data.actionType === 'pause'
                    ? 'paused the movie'
                    : 'jumped to another scene';
                showToast(`${data.actionBy} ${actionLabel}`, 'info');
              }
              return;
            }

            if (data.type === 'chat:new_message') {
              setChatMessages((prev) => [...prev, data.message]);
              // Announce it to everyone but the author, who already saw it.
              const msg = data.message;
              if (msg && msg.senderId !== myIdRef.current && !msg.isSystem) {
                setChatNotifications((prev) => [
                  ...prev.slice(-2), // keep the stack short
                  {
                    id: msg.id,
                    senderName: msg.senderName,
                    avatar: msg.avatar,
                    text: msg.text,
                  },
                ]);
                setTimeout(() => {
                  setChatNotifications((prev) => prev.filter((n) => n.id !== msg.id));
                }, CHAT_NOTIFICATION_MS);
              }
              return;
            }

            if (data.type === 'room:participants_updated') {
              setParticipants(data.participants);
              return;
            }

            if (data.type === 'room:movie_updated') {
              setRoom((prev) => (prev ? {
                ...prev,
                movie: data.movie,
                scheduledTime: data.scheduledTime,
                status: data.status,
                currentTime: 0,
                isPlaying: false,
              } : null));

              if (videoRef.current) {
                videoRef.current.currentTime = 0;
                videoRef.current.pause();
              }
              return;
            }

            if (data.type === 'room:notification') {
              showToast(data.text, data.variant || 'info');
              return;
            }

            // This account is open more than once, so voice has no second party.
            if (data.type === 'room:duplicate_session') {
              setDuplicateSession(data.text);
              return;
            }

            if (data.type === 'admin:new_pending_user') {
              if (userRef.current?.role === 'admin') {
                showToast(`کاربر جدید "${data.user.displayName}" درخواست ورود دارد.`, 'info');
                onNewPendingUserRef.current?.(data.user);
              }
              return;
            }

            // Someone added or removed a subtitle for the video being watched.
            // Bumping the counter makes the player refetch its track list, so a
            // new subtitle appears without anyone having to reload.
            if (data.type === 'subtitles:updated') {
              setSubtitlesVersion((v) => v + 1);
              if (data.by && data.by !== myIdRef.current) {
                showToast(
                  data.action === 'removed'
                    ? 'یک زیرنویس حذف شد.'
                    : 'زیرنویس جدیدی برای این ویدیو اضافه شد.',
                  'info'
                );
              }
              return;
            }

            // Live Voice: WebRTC handshake from another participant. The audio
            // itself never comes through the socket, only offers and candidates.
            if (data.type === 'rtc:signal') {
              handleSignalRef.current?.(data.senderId, data.kind, data.payload);
              return;
            }

            // Live Voice: User speaking indicator
            if (data.type === 'voice:user_speaking') {
              setSpeakingUserIds((prev) => {
                const next = new Set(prev);
                if (data.isSpeaking) {
                  next.add(data.userId);
                } else {
                  next.delete(data.userId);
                }
                return next;
              });
              return;
            }
          } catch (err) {
            console.error('Error handling WS event:', err);
          }
        };

        ws.onclose = () => {
          setIsConnected(false);
          clearInterval(pingInterval);
          if (!isDisposed) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = setTimeout(connect, 2000);
          }
        };

        ws.onerror = (err) => {
          console.warn('[WS] Socket event:', err);
        };
      } catch (err) {
        console.error('Failed to initialize WebSocket:', err);
        if (!isDisposed) {
          clearTimeout(reconnectTimeout);
          reconnectTimeout = setTimeout(connect, 3000);
        }
      }
    }

    connect();

    return () => {
      isDisposed = true;
      clearInterval(pingInterval);
      clearTimeout(reconnectTimeout);
      if (ws) ws.close();
    };
  }, [roomId, user.id]);

  // Sync quality changes to server without reconnecting the WebSocket
  useEffect(() => {
    if (socketRef.current?.readyState === WebSocket.OPEN && user.quality) {
      socketRef.current.send(
        JSON.stringify({
          type: 'user:quality',
          quality: user.quality,
        })
      );
    }
  }, [user.quality]);

  // High precision client-side drift monitor and auto-sync check
  useEffect(() => {
    const syncInterval = setInterval(() => {
      if (!room || !videoRef.current || isRemoteActionRef.current) return;
      if (!room.isPlaying) return;

      // Guard: Do not drift or pretend to tick if video element is errored or has no source loaded
      const el = videoRef.current;
      if (el.error || el.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) return;
      if (el.readyState === 0 && !el.currentSrc) return;

      const clientNow = Date.now();
      const serverEstimatedNow = clientNow + serverTimeOffset;
      const elapsedSec = (serverEstimatedNow - room.lastUpdatedServerTime) / 1000;
      const expectedTime = Math.max(0, room.currentTime + elapsedSec * room.playbackRate);

      const actualTime = videoRef.current.currentTime;
      const drift = expectedTime - actualTime;

      if (Math.abs(drift) > 1.2) {
        isRemoteActionRef.current = true;
        videoRef.current.currentTime = expectedTime;
        setTimeout(() => {
          isRemoteActionRef.current = false;
        }, 300);
      } else if (Math.abs(drift) > 0.3) {
        const targetRate = drift > 0 ? room.playbackRate * 1.04 : room.playbackRate * 0.96;
        videoRef.current.playbackRate = targetRate;
      } else {
        if (videoRef.current.playbackRate !== room.playbackRate) {
          videoRef.current.playbackRate = room.playbackRate;
        }
      }
    }, 600);

    return () => clearInterval(syncInterval);
  }, [room, serverTimeOffset]);

  // ---------------------------------------------------------------------------
  // WebRTC voice mesh
  // ---------------------------------------------------------------------------

  const sendSignal = useCallback((target: string, kind: string, payload: any) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'rtc:signal', target, kind, payload }));
    }
  }, []);

  /**
   * Loads the ICE servers once per session. The TURN credentials it returns are
   * short-lived and tied to this user, so they are fetched rather than hardcoded.
   * A failure is not fatal: an empty list still allows peers on the same network
   * to connect over host candidates.
   */
  const ensureIceServers = useCallback((): Promise<void> => {
    if (!iceReadyRef.current) {
      iceReadyRef.current = fetch('/api/rtc/ice', { credentials: 'include' })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
        .then((data) => {
          if (Array.isArray(data?.iceServers)) iceServersRef.current = data.iceServers;
        })
        .catch((err) => {
          console.warn('Could not load ICE servers; voice may not connect across networks:', err);
        });
    }
    return iceReadyRef.current;
  }, []);

  /** Stops and forgets one peer. */
  const closePeer = useCallback((peerId: string) => {
    const peer = peersRef.current.get(peerId);
    if (!peer) return;
    peersRef.current.delete(peerId);
    try {
      peer.pc.ontrack = null;
      peer.pc.onicecandidate = null;
      peer.pc.onnegotiationneeded = null;
      peer.pc.onconnectionstatechange = null;
      peer.pc.close();
    } catch {
      // already closed
    }
    peer.audio.srcObject = null;
    peer.audio.remove();
    setVoicePeerStates((prev) => {
      if (!(peerId in prev)) return prev;
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
  }, []);

  /**
   * Opens the connection to one participant, following the "perfect negotiation"
   * pattern so that two peers offering simultaneously cannot deadlock.
   *
   * The audio transceiver is created immediately with no track attached. That
   * fixes the shape of the session once, so switching the microphone on later —
   * and every push-to-talk press after that — costs no renegotiation.
   */
  const getOrCreatePeer = useCallback((peerId: string): PeerConn => {
    const existing = peersRef.current.get(peerId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });

    // Incoming voice plays through a detached element, one per peer, so each can
    // be muted individually without touching the others.
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.muted = locallyMutedUserIdsRef.current.has(peerId);
    (audio as any).playsInline = true;
    // Kept in the document: a detached element is an unreliable sink for a
    // remote WebRTC stream, and it stays hidden either way.
    audio.style.display = 'none';
    audio.dataset.voicePeer = peerId;
    document.body.appendChild(audio);

    const peer: PeerConn = {
      pc,
      sender: null,
      audio,
      // The two ends must reach opposite answers, so compare the ids.
      polite: myIdRef.current < peerId,
      makingOffer: false,
      ignoreOffer: false,
    };
    peersRef.current.set(peerId, peer);

    peer.sender = pc.addTransceiver('audio', { direction: 'sendrecv' }).sender;
    // If the mic is already live, this peer should hear it from the first frame.
    if (mediaStreamRef.current) {
      const track = mediaStreamRef.current.getAudioTracks()[0];
      if (track) peer.sender.replaceTrack(track).catch(() => {});
    }

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        sendSignal(peerId, 'offer', pc.localDescription);
      } catch (err) {
        console.warn('Voice negotiation failed:', err);
      } finally {
        peer.makingOffer = false;
      }
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) sendSignal(peerId, 'candidate', candidate.toJSON());
    };

    pc.ontrack = ({ streams, track }) => {
      const stream = streams[0] ?? new MediaStream([track]);
      if (peer.audio.srcObject !== stream) {
        peer.audio.srcObject = stream;
      }
      // Autoplay is blocked until the page has been interacted with; surface it
      // rather than leaving the user wondering why nobody can be heard.
      peer.audio.play().then(
        () => setIsVoiceBlocked(false),
        () => setIsVoiceBlocked(true)
      );
    };

    pc.onconnectionstatechange = () => {
      setVoicePeerStates((prev) => ({ ...prev, [peerId]: pc.connectionState }));
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') {
        // A path that worked can break when a network changes; ask for new candidates.
        try {
          pc.restartIce();
        } catch {
          // older browsers: the connection is rebuilt on the next participant update
        }
      }
    };

    return peer;
  }, [sendSignal]);

  /** Handles one inbound offer / answer / ICE candidate. */
  const handleSignal = useCallback(
    async (senderId: string, kind: string, payload: any) => {
      if (!senderId || senderId === myIdRef.current) return;
      await ensureIceServers();

      const peer = getOrCreatePeer(senderId);
      const { pc } = peer;

      try {
        if (kind === 'offer' || kind === 'answer') {
          const collision = kind === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
          // Only the impolite peer may refuse; otherwise both would back off.
          peer.ignoreOffer = !peer.polite && collision;
          if (peer.ignoreOffer) return;

          await pc.setRemoteDescription(payload);
          if (kind === 'offer') {
            await pc.setLocalDescription();
            sendSignal(senderId, 'answer', pc.localDescription);
          }
          return;
        }

        if (kind === 'candidate') {
          try {
            await pc.addIceCandidate(payload);
          } catch (err) {
            // Candidates that arrive for an offer we discarded are expected.
            if (!peer.ignoreOffer) throw err;
          }
        }
      } catch (err) {
        console.warn(`Voice signalling error (${kind}) from ${senderId}:`, err);
      }
    },
    [ensureIceServers, getOrCreatePeer, sendSignal]
  );

  /** Pushes the current microphone track (or silence) to every peer. */
  const applyLocalTrackToPeers = useCallback((track: MediaStreamTrack | null) => {
    peersRef.current.forEach((peer) => {
      peer.sender?.replaceTrack(track).catch(() => {});
    });
  }, []);

  useEffect(() => {
    handleSignalRef.current = handleSignal;
  }, [handleSignal]);

  // Keep one connection per online participant: open one for anybody new, drop
  // the ones who left. Both ends run this, and perfect negotiation settles who
  // offers, so it does not matter who notices the other first.
  useEffect(() => {
    if (!roomId || !isConnected) return;

    const peerIds = participants
      .filter((p) => p.id !== myIdRef.current && p.online)
      .map((p) => p.id);

    for (const id of Array.from(peersRef.current.keys())) {
      if (!peerIds.includes(id)) closePeer(id);
    }

    if (peerIds.length === 0) return;
    let cancelled = false;
    ensureIceServers().then(() => {
      if (cancelled) return;
      peerIds.forEach((id) => getOrCreatePeer(id));
    });
    return () => {
      cancelled = true;
    };
  }, [participants, roomId, isConnected, ensureIceServers, getOrCreatePeer, closePeer]);

  // Tear the whole mesh down when leaving the room or unmounting.
  useEffect(() => {
    return () => {
      Array.from(peersRef.current.keys()).forEach(closePeer);
    };
  }, [roomId, closePeer]);

  // Muting a participant silences their own audio element, leaving everyone
  // else untouched and the connection up so unmuting is instant.
  useEffect(() => {
    peersRef.current.forEach((peer, id) => {
      peer.audio.muted = locallyMutedUserIds.has(id);
    });
  }, [locallyMutedUserIds]);

  // Open mic: persist the choice and keep the ref the callbacks read in sync.
  useEffect(() => {
    isOpenMicRef.current = isOpenMic;
    try {
      localStorage.setItem(OPEN_MIC_KEY, String(isOpenMic));
    } catch {
      // private browsing: the setting just will not persist
    }
  }, [isOpenMic]);

  // Voice Chat: Handle Microphone Stream & Voice Activity Detection (VAD)
  const stopMicrophone = useCallback((isPtt = false) => {
    if (isPtt) {
      // Push-to-talk release: keep the capture stream and the WebRTC senders in
      // place and just mute the track, so the next press is audible immediately.
      mediaStreamRef.current?.getAudioTracks().forEach((track) => {
        track.enabled = false;
      });
    } else {
      // Toggled off for good: detach from the peers and release the device, so
      // the browser's recording indicator goes away.
      if (vadAnimationRef.current) {
        cancelAnimationFrame(vadAnimationRef.current);
        vadAnimationRef.current = null;
      }
      applyLocalTrackToPeers(null);
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        try {
          audioContextRef.current.close();
        } catch {
          // already closing
        }
        audioContextRef.current = null;
      }
      analyserRef.current = null;
    }

    setIsMicActive(false);
    isMicActiveRef.current = false;
    setIsLocalSpeaking(false);
    isSpeakingRef.current = false;

    // Broadcast mic closed & not speaking
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: 'voice:mic_state', isMicOn: false }));
      socketRef.current.send(JSON.stringify({ type: 'voice:speaking', isSpeaking: false }));
    }
  }, [applyLocalTrackToPeers]);

  const startMicrophone = useCallback(async (isPtt = false) => {
    try {
      if (isPtt) {
        isPttTriggeredRef.current = true;
      }
      // Needed before any peer connection is built, and cheap once resolved.
      await ensureIceServers();

      let stream = mediaStreamRef.current;

      // If we already have an active stream, immediately re-enable tracks (0ms latency!)
      if (stream && stream.active && stream.getAudioTracks().length > 0) {
        const track = stream.getAudioTracks()[0];
        stream.getAudioTracks().forEach((t) => {
          t.enabled = true;
        });
        // The senders normally still hold this track; re-attach in case the mic
        // was fully stopped and is being switched back on.
        applyLocalTrackToPeers(track);

        setIsMicActive(true);
        isMicActiveRef.current = true;

        if (socketRef.current?.readyState === WebSocket.OPEN) {
          socketRef.current.send(JSON.stringify({ type: 'voice:mic_state', isMicOn: true }));
        }
        return;
      }

      // First time initialization: request getUserMedia
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      mediaStreamRef.current = stream;

      // AudioContext for Voice Activity Detection
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.4;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Voice Activity Detection loop
      const buffer = new Uint8Array(analyser.frequencyBinCount);
      let silenceFrames = 0;

      const checkVolume = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
          sum += buffer[i];
        }
        const average = sum / buffer.length;
        const isSpeakingNow = average > 14;

        if (isSpeakingNow && isMicActiveRef.current) {
          silenceFrames = 0;
          if (!isSpeakingRef.current) {
            isSpeakingRef.current = true;
            setIsLocalSpeaking(true);
            if (socketRef.current?.readyState === WebSocket.OPEN) {
              socketRef.current.send(JSON.stringify({ type: 'voice:speaking', isSpeaking: true }));
            }
          }
        } else {
          silenceFrames++;
          if (silenceFrames > 8 && isSpeakingRef.current) {
            isSpeakingRef.current = false;
            setIsLocalSpeaking(false);
            if (socketRef.current?.readyState === WebSocket.OPEN) {
              socketRef.current.send(JSON.stringify({ type: 'voice:speaking', isSpeaking: false }));
            }
          }
        }

        vadAnimationRef.current = requestAnimationFrame(checkVolume);
      };

      vadAnimationRef.current = requestAnimationFrame(checkVolume);

      // Hand the live track to every peer. Opus encoding, packetisation and the
      // receive-side jitter buffer are all WebRTC's job from here on.
      const micTrack = stream.getAudioTracks()[0];
      applyLocalTrackToPeers(micTrack);

      // If the user released M before the permission dialog was answered, keep
      // the stream for next time but start out silent. Open mic overrides this:
      // there the microphone is meant to stay live regardless of the key.
      if (isPtt && !isPTTHeldRef.current && !isOpenMicRef.current) {
        stream.getAudioTracks().forEach((t) => {
          t.enabled = false;
        });
        setIsMicActive(false);
        isMicActiveRef.current = false;
        return;
      }

      setIsMicActive(true);
      isMicActiveRef.current = true;

      // Broadcast mic state to room
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: 'voice:mic_state', isMicOn: true }));
      }

      if (!isPtt) {
        showToast('میکروفون فعال شد. شما می‌توانید با اعضای اتاق صحبت کنید.', 'success');
      }
    } catch (err: any) {
      console.error('Failed to access microphone:', err);
      showToast('دسترسی به میکروفون داده نشد یا در دسترس نیست.', 'warning');
      setIsMicActive(false);
      isMicActiveRef.current = false;
      isPTTHeldRef.current = false;
      isPttTriggeredRef.current = false;
      stopMicrophone(false);
    }
  }, [showToast, stopMicrophone, applyLocalTrackToPeers, ensureIceServers]);

  const toggleMic = useCallback(async () => {
    if (isMicActive) {
      stopMicrophone(false);
      showToast('میکروفون بی‌صدا (خاموش) شد.', 'info');
    } else {
      await startMicrophone(false);
    }
  }, [isMicActive, startMicrophone, stopMicrophone, showToast]);

  /**
   * Turns the "leave the mic open" mode on or off. With it on the microphone
   * stays live for the session and M is not needed; turning it off closes the
   * mic again so it cannot be left on unnoticed.
   */
  const toggleOpenMic = useCallback(() => {
    setIsOpenMic((prev) => {
      const next = !prev;
      isOpenMicRef.current = next;
      if (next) {
        startMicrophone(false);
        showToast('میکروفون همیشه باز است. برای صحبت لازم نیست M را نگه دارید.', 'success');
      } else {
        stopMicrophone(false);
        showToast('میکروفون همیشه‌باز خاموش شد. برای صحبت کلید M را نگه دارید.', 'info');
      }
      return next;
    });
  }, [startMicrophone, stopMicrophone, showToast]);

  // With open mic on, bring the microphone up as soon as the room is joined,
  // and again after a reconnect, without waiting for a key press.
  useEffect(() => {
    if (!roomId || !isConnected || !isOpenMic || isMicActiveRef.current) return;
    startMicrophone(false);
  }, [roomId, isConnected, isOpenMic, startMicrophone]);

  // Global Push-To-Talk (PTT) Keyboard Listener for 'M' key
  useEffect(() => {
    if (!roomId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is currently typing inside an input or textarea
      const target = e.target as HTMLElement;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          target.getAttribute('role') === 'textbox')
      ) {
        return;
      }

      if (e.key === 'm' || e.key === 'M' || e.code === 'KeyM') {
        if (e.repeat) return; // Ignore repeated OS keydown events while held
        // Open mic already holds the microphone open; M has nothing to do.
        if (isOpenMicRef.current) return;

        isPTTHeldRef.current = true;
        setIsPushToTalkActive(true);

        if (!isMicActiveRef.current) {
          startMicrophone(true);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'm' || e.key === 'M' || e.code === 'KeyM') {
        isPTTHeldRef.current = false;
        setIsPushToTalkActive(false);

        // Releasing M must not close a mic the user asked to stay open.
        if (isPttTriggeredRef.current) {
          isPttTriggeredRef.current = false;
          if (!isOpenMicRef.current) stopMicrophone(true);
        }
      }
    };

    const handleBlur = () => {
      if (isPTTHeldRef.current) {
        isPTTHeldRef.current = false;
        setIsPushToTalkActive(false);
        if (isPttTriggeredRef.current) {
          isPttTriggeredRef.current = false;
          if (!isOpenMicRef.current) stopMicrophone(true);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [roomId, startMicrophone, stopMicrophone]);

  // Clean up mic on unmount
  useEffect(() => {
    return () => {
      stopMicrophone(false);
    };
  }, [stopMicrophone]);

  // A plain summary of the voice mesh, so the UI can tell "nobody to talk to"
  // apart from "connecting" and from "the connection failed" — three situations
  // that otherwise all look like a microphone that works but is never heard.
  const voiceStats = (() => {
    const states = Object.values(voicePeerStates);
    const peers = Math.max(states.length, peersRef.current.size);
    return {
      peers,
      connected: states.filter((st) => st === 'connected').length,
      connecting: states.filter((st) => st === 'new' || st === 'connecting').length,
      failed: states.filter((st) => st === 'failed' || st === 'disconnected').length,
    };
  })();

  /** Removes one message banner early, when the reader dismisses it. */
  const dismissChatNotification = useCallback((id: string) => {
    setChatNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  /**
   * Retries playback of every peer's audio. Browsers refuse to start audio
   * before the page has been interacted with, so this is called from a click.
   */
  const resumeVoicePlayback = useCallback(() => {
    let blocked = false;
    peersRef.current.forEach((peer) => {
      peer.audio.play().catch(() => {
        blocked = true;
      });
    });
    setIsVoiceBlocked(blocked);
  }, []);

  // Toggle local mute for a specific user
  const toggleMuteUser = useCallback((targetUserId: string, targetName?: string) => {
    setLocallyMutedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(targetUserId)) {
        next.delete(targetUserId);
        showToast(`صدای ${targetName || 'کاربر'} برای شما وصل شد.`, 'success');
      } else {
        next.add(targetUserId);
        showToast(`صدای ${targetName || 'کاربر'} برای شما بی‌صدا شد.`, 'info');
      }
      return next;
    });
  }, [showToast]);

  // Video Action Dispatchers
  const sendVideoAction = useCallback(
    (action: 'play' | 'pause' | 'seek' | 'rate', currentTime: number, playbackRate?: number) => {
      if (isRemoteActionRef.current) return;
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(
          JSON.stringify({
            type: 'video:action',
            action,
            currentTime,
            playbackRate,
            actionBy: user.name,
          })
        );
      }
    },
    [user.name]
  );

  const sendChatMessage = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(
          JSON.stringify({
            type: 'chat:message',
            text: text.trim(),
            sender: {
              id: user.id,
              name: user.name,
              avatar: user.avatar,
            },
          })
        );
      }
    },
    [user.id, user.name, user.avatar]
  );

  const changeQuality = useCallback(
    (quality: string) => {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(
          JSON.stringify({
            type: 'user:quality',
            quality,
          })
        );
      }
    },
    []
  );

  const updateMovie = useCallback(
    (movie: Partial<MovieInfo>) => {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(
          JSON.stringify({
            type: 'room:update_movie',
            movie,
          })
        );
      }
    },
    []
  );

  const updateSchedule = useCallback(
    (scheduledTime: string | null, status?: 'scheduled' | 'playing') => {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(
          JSON.stringify({
            type: 'room:update_schedule',
            scheduledTime,
            status,
          })
        );
      }
    },
    []
  );

  return {
    room,
    participants,
    chatMessages,
    latencyMs,
    isConnected,
    videoRef,
    toastNotification,
    chatNotifications,
    dismissChatNotification,
    subtitlesVersion,
    isMicActive,
    isPushToTalkActive,
    isLocalSpeaking,
    isOpenMic,
    isVoiceBlocked,
    voiceStats,
    duplicateSession,
    speakingUserIds,
    locallyMutedUserIds,
    toggleMic,
    toggleOpenMic,
    resumeVoicePlayback,
    toggleMuteUser,
    sendVideoAction,
    sendChatMessage,
    changeQuality,
    updateMovie,
    updateSchedule,
    showToast,
  };
}
