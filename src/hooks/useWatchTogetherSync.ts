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

export function useWatchTogetherSync({ roomId, user, onNewPendingUser }: UseWatchTogetherSyncOptions) {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [latencyMs, setLatencyMs] = useState<number>(12);
  const [serverTimeOffset, setServerTimeOffset] = useState<number>(0);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [toastNotification, setToastNotification] = useState<{ text: string; variant?: string } | null>(null);

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

  const isMicActiveRef = useRef<boolean>(false);
  const isPTTHeldRef = useRef<boolean>(false);
  const isPttTriggeredRef = useRef<boolean>(false);

  const socketRef = useRef<WebSocket | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const isRemoteActionRef = useRef<boolean>(false);
  const toastTimeoutRef = useRef<any>(null);

  // Voice Recording Refs
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const vadAnimationRef = useRef<number | null>(null);
  const isSpeakingRef = useRef<boolean>(false);
  const locallyMutedUserIdsRef = useRef<Set<string>>(locallyMutedUserIds);
  const userRef = useRef(user);
  const onNewPendingUserRef = useRef(onNewPendingUser);

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

            if (data.type === 'admin:new_pending_user') {
              if (userRef.current?.role === 'admin') {
                showToast(`کاربر جدید "${data.user.displayName}" درخواست ورود دارد.`, 'info');
                onNewPendingUserRef.current?.(data.user);
              }
              return;
            }

            // Live Voice: Incoming audio chunk from participant
            if (data.type === 'voice:audio') {
              const senderId = data.senderId;
              // Check if user has muted this sender locally
              if (locallyMutedUserIdsRef.current.has(senderId)) {
                return; // Muted by user: silent drop
              }

              // Play incoming voice chunk
              try {
                const audioEl = new Audio(`data:${data.mimeType || 'audio/webm'};base64,${data.chunk}`);
                audioEl.volume = 1.0;
                audioEl.play().catch(() => {});
              } catch (audioErr) {
                console.warn('Voice chunk playback error:', audioErr);
              }
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

  // Voice Chat: Handle Microphone Stream & Voice Activity Detection (VAD)
  const stopMicrophone = useCallback((isPtt = false) => {
    if (isPtt) {
      // Push-To-Talk release: keep stream warm and disable tracks instantly for 0ms lag next time
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getAudioTracks().forEach((track) => {
          track.enabled = false;
        });
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        try {
          mediaRecorderRef.current.pause();
        } catch {}
      }
    } else {
      // Full stop / toggle off: stop all tracks & recorder
      if (vadAnimationRef.current) {
        cancelAnimationFrame(vadAnimationRef.current);
        vadAnimationRef.current = null;
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.stop();
        } catch {}
        mediaRecorderRef.current = null;
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        try {
          audioContextRef.current.close();
        } catch {}
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
  }, []);

  const startMicrophone = useCallback(async (isPtt = false) => {
    try {
      if (isPtt) {
        isPttTriggeredRef.current = true;
      }

      let stream = mediaStreamRef.current;

      // If we already have an active stream, immediately re-enable tracks (0ms latency!)
      if (stream && stream.active && stream.getAudioTracks().length > 0) {
        stream.getAudioTracks().forEach((track) => {
          track.enabled = true;
        });

        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
          try {
            mediaRecorderRef.current.resume();
          } catch {}
        }

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

      // MediaRecorder to record audio chunks and stream to peers
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/ogg';

      const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32000 });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = async (e) => {
        if (
          isMicActiveRef.current &&
          e.data &&
          e.data.size > 0 &&
          socketRef.current?.readyState === WebSocket.OPEN
        ) {
          // Convert audio blob to base64
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64 = (reader.result as string)?.split(',')[1];
            if (base64 && isMicActiveRef.current && socketRef.current?.readyState === WebSocket.OPEN) {
              socketRef.current.send(
                JSON.stringify({
                  type: 'voice:audio',
                  chunk: base64,
                  mimeType,
                  senderName: userRef.current.name,
                })
              );
            }
          };
          reader.readAsDataURL(e.data);
        }
      };

      recorder.start(250); // Emit audio packet every 250ms for low latency

      // If user released M key before permission dialog finished
      if (isPtt && !isPTTHeldRef.current) {
        stream.getAudioTracks().forEach((t) => { t.enabled = false; });
        if (recorder.state === 'recording') {
          try { recorder.pause(); } catch {}
        }
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
  }, [showToast, stopMicrophone]);

  const toggleMic = useCallback(async () => {
    if (isMicActive) {
      stopMicrophone(false);
      showToast('میکروفون بی‌صدا (خاموش) شد.', 'info');
    } else {
      await startMicrophone(false);
    }
  }, [isMicActive, startMicrophone, stopMicrophone, showToast]);

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

        if (isPttTriggeredRef.current) {
          isPttTriggeredRef.current = false;
          stopMicrophone(true);
        }
      }
    };

    const handleBlur = () => {
      if (isPTTHeldRef.current) {
        isPTTHeldRef.current = false;
        setIsPushToTalkActive(false);
        if (isPttTriggeredRef.current) {
          isPttTriggeredRef.current = false;
          stopMicrophone(true);
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
    isMicActive,
    isPushToTalkActive,
    isLocalSpeaking,
    speakingUserIds,
    locallyMutedUserIds,
    toggleMic,
    toggleMuteUser,
    sendVideoAction,
    sendChatMessage,
    changeQuality,
    updateMovie,
    updateSchedule,
    showToast,
  };
}
