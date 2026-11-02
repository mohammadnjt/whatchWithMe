import { useState, useEffect, useRef, useCallback } from 'react';
import { RoomState, Participant, ChatMessage, MovieInfo } from '../types';

interface UseWatchTogetherSyncOptions {
  roomId: string;
  user: {
    id: string;
    name: string;
    avatar: string;
    quality: string;
  };
}

export function useWatchTogetherSync({ roomId, user }: UseWatchTogetherSyncOptions) {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [latencyMs, setLatencyMs] = useState<number>(12);
  const [serverTimeOffset, setServerTimeOffset] = useState<number>(0);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [toastNotification, setToastNotification] = useState<{ text: string; variant?: string } | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const isRemoteActionRef = useRef<boolean>(false);
  const toastTimeoutRef = useRef<any>(null);

  const showToast = useCallback((text: string, variant: string = 'info') => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastNotification({ text, variant });
    toastTimeoutRef.current = setTimeout(() => {
      setToastNotification(null);
    }, 3500);
  }, []);

  // Initialize and maintain WebSocket connection
  useEffect(() => {
    let ws: WebSocket;
    let pingInterval: any;
    let reconnectTimeout: any;
    let isDisposed = false;

    function connect() {
      if (isDisposed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}`;

      try {
        ws = new WebSocket(wsUrl);
        socketRef.current = ws;

        ws.onopen = () => {
          setIsConnected(true);
          // Send join message
          ws.send(
            JSON.stringify({
              type: 'join',
              roomId,
              user,
            })
          );

          // Start NTP-style ping routine every 2.5s for ultra-accurate clock sync and latency calculation
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
              // Server time offset = (serverTime + rtt/2) - clientNow
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
                
                // Only seek if drift exceeds 300ms to avoid unnecessary audio stutter
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
          } catch (err) {
            console.error('Error handling WS event:', err);
          }
        };

        ws.onclose = () => {
          setIsConnected(false);
          clearInterval(pingInterval);
          if (!isDisposed) {
            reconnectTimeout = setTimeout(connect, 2000);
          }
        };

        ws.onerror = () => {
          ws.close();
        };
      } catch (err) {
        console.error('Failed to initialize WebSocket:', err);
        if (!isDisposed) {
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
  }, [roomId, user.id, user.name, user.avatar, user.quality, showToast]);

  // High precision client-side drift monitor and auto-sync check
  useEffect(() => {
    const syncInterval = setInterval(() => {
      if (!room || !videoRef.current || isRemoteActionRef.current) return;
      if (!room.isPlaying) return;

      const clientNow = Date.now();
      const serverEstimatedNow = clientNow + serverTimeOffset;
      const elapsedSec = (serverEstimatedNow - room.lastUpdatedServerTime) / 1000;
      const expectedTime = Math.max(0, room.currentTime + elapsedSec * room.playbackRate);

      const actualTime = videoRef.current.currentTime;
      const drift = expectedTime - actualTime;

      // If drift is substantial (> 1.2s), snap directly
      if (Math.abs(drift) > 1.2) {
        isRemoteActionRef.current = true;
        videoRef.current.currentTime = expectedTime;
        setTimeout(() => {
          isRemoteActionRef.current = false;
        }, 300);
      } else if (Math.abs(drift) > 0.3) {
        // Micro-adjust playback speed for seamless smooth synchronization without harsh audio cuts!
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
    sendVideoAction,
    sendChatMessage,
    changeQuality,
    updateMovie,
    updateSchedule,
    showToast,
  };
}
