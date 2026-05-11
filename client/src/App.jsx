import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";

const SERVER_URL = import.meta.env.VITE_SERVER_URL;

const ROLE = {
  HOST: "host",
  MODERATOR: "moderator",
  PARTICIPANT: "participant",
};

const socket = io(SERVER_URL, { autoConnect: true });

function parseVideoId(value) {
  const input = (value || "").trim();
  if (!input) return "";
  if (!input.includes("http")) return input;

  try {
    const url = new URL(input);
    if (url.hostname.includes("youtu.be")) return url.pathname.replace("/", "");
    return url.searchParams.get("v") || "";
  } catch {
    return "";
  }
}

export default function App() {
  const playerRef = useRef(null);
  const suppressRef = useRef(false);

  const [playerReady, setPlayerReady] = useState(false);
  const [username, setUsername] = useState("");
  const [roomInput, setRoomInput] = useState("");
  const [videoInput, setVideoInput] = useState("");
  const [roomId, setRoomId] = useState("");
  const [myRole, setMyRole] = useState("");
  const [myUserId, setMyUserId] = useState("");
  const [participants, setParticipants] = useState([]);
  const [message, setMessage] = useState("");
  const [backendReady, setBackendReady] = useState(false);

  const canControl = useMemo(
    () => myRole === ROLE.HOST || myRole === ROLE.MODERATOR,
    [myRole]
  );

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    document.body.appendChild(script);

    window.onYouTubeIframeAPIReady = () => {
      playerRef.current = new window.YT.Player("player", {
        height: "500",
        width: "100%",
        videoId: "dQw4w9WgXcQ",
        playerVars: { controls: 1, autoplay: 0 },
      });

      setPlayerReady(true);
    };

    return () => {
      if (playerRef.current?.destroy) playerRef.current.destroy();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const warmupBackend = async () => {
      try {
        const response = await fetch(`${SERVER_URL}/api/health`, {
          method: "GET",
          cache: "no-store",
        });

        if (!cancelled && response.ok) {
          setBackendReady(true);

          if (!message) {
            setMessage("Server connected successfully.");
          }
        }
      } catch {
        if (!cancelled) {
          setMessage("Waking backend server...");
        }
      }
    };

    warmupBackend();

    const interval = setInterval(warmupBackend, 15000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const updateParticipants = (list) => {
      setParticipants(list || []);

      const me = (list || []).find((p) => p.userId === socket.id);

      if (me) {
        setMyRole(me.role);
        setMyUserId(me.userId);
      }
    };

    socket.on(
      "room_created",
      ({ roomId: id, userId, role, participants: list, syncState }) => {
        setRoomId(id);
        setRoomInput(id);
        setMyRole(role);
        setMyUserId(userId);
        setParticipants(list || []);
        applySync(syncState);
        setMessage("Room created successfully.");
      }
    );

    socket.on("user_joined", ({ participants: list }) =>
      updateParticipants(list)
    );

    socket.on("user_left", ({ participants: list }) =>
      updateParticipants(list)
    );

    socket.on("role_assigned", ({ participants: list }) =>
      updateParticipants(list)
    );

    socket.on("participant_removed", ({ participants: list }) =>
      updateParticipants(list)
    );

    socket.on("sync_state", (state) => applySync(state));

    socket.on("kicked", ({ message: msg }) => {
      setRoomId("");
      setParticipants([]);
      setMyRole("");
      setMessage(msg || "Removed by host");
    });

    socket.on("action_rejected", ({ message: msg }) =>
      setMessage(msg || "Action rejected")
    );

    socket.on("connect", () => setBackendReady(true));

    socket.on("disconnect", () => setBackendReady(false));

    return () => {
      socket.off("room_created");
      socket.off("user_joined");
      socket.off("user_left");
      socket.off("role_assigned");
      socket.off("participant_removed");
      socket.off("sync_state");
      socket.off("kicked");
      socket.off("action_rejected");
      socket.off("connect");
      socket.off("disconnect");
    };
  }, [playerReady]);

  const applySync = (state) => {
    if (!playerRef.current || !state) return;

    suppressRef.current = true;

    const player = playerRef.current;

    const currentVideoId = player?.getVideoData?.().video_id;

    if (state.videoId && currentVideoId !== state.videoId) {
      player.loadVideoById(state.videoId, state.currentTime || 0);
    } else if (typeof state.currentTime === "number") {
      player.seekTo(state.currentTime, true);
    }

    if (state.playState === "playing") player.playVideo();
    else player.pauseVideo();

    setTimeout(() => {
      suppressRef.current = false;
    }, 250);
  };

  const emitCreate = () =>
    socket.emit("create_room", {
      username: username || "Host",
    });

  const emitJoin = () => {
    socket.emit("join_room", {
      roomId: roomInput,
      username: username || "Guest",
    });

    setRoomId(roomInput.trim().toUpperCase());
  };

  const changeVideo = () => {
    const videoId = parseVideoId(videoInput);

    if (!videoId) {
      return setMessage("Valid YouTube URL or ID required");
    }

    socket.emit("change_video", { videoId });
  };

  const emitPlay = () => socket.emit("play");

  const emitPause = () => {
    const t = playerRef.current?.getCurrentTime?.() || 0;

    socket.emit("pause", { time: t });
  };

  const assignRole = (userId, role) =>
    socket.emit("assign_role", { userId, role });

  const removeParticipant = (userId) =>
    socket.emit("remove_participant", { userId });

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-7xl px-4 py-6">

        {/* HEADER */}
        <div className="mb-6 flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl lg:flex-row lg:items-center lg:justify-between">

          <div>
            <h1 className="text-4xl font-black tracking-tight">
              Lizzn Watch Party
            </h1>

            <p className="mt-2 text-sm text-zinc-400">
              Real-time synchronized YouTube streaming experience.
            </p>
          </div>

          <div className="flex gap-3">
            <div className="rounded-2xl bg-zinc-900 px-4 py-3">
              <p className="text-xs text-zinc-400">Room</p>
              <p className="font-semibold">{roomId || "Not Joined"}</p>
            </div>

            <div className="rounded-2xl bg-zinc-900 px-4 py-3">
              <p className="text-xs text-zinc-400">Role</p>
              <p className="font-semibold capitalize">
                {myRole || "None"}
              </p>
            </div>

            <div className="rounded-2xl bg-zinc-900 px-4 py-3">
              <p className="text-xs text-zinc-400">Backend</p>

              <p
                className={`font-semibold ${
                  backendReady ? "text-green-400" : "text-yellow-400"
                }`}
              >
                {backendReady ? "Connected" : "Warming"}
              </p>
            </div>
          </div>
        </div>

        {/* MAIN */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">

          {/* LEFT */}
          <div className="space-y-6 lg:col-span-3">

            {/* ROOM PANEL */}
            <div className="rounded-3xl border border-white/10 bg-zinc-950/80 p-5 shadow-2xl">

              <div className="grid gap-4 md:grid-cols-4">

                <input
                  className="rounded-2xl border border-white/10 bg-black px-4 py-3 outline-none transition focus:border-purple-500"
                  placeholder="Your Name"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />

                <button
                  className="rounded-2xl bg-purple-600 px-5 py-3 font-semibold transition hover:bg-purple-500"
                  onClick={emitCreate}
                >
                  Create Room
                </button>

                <input
                  className="rounded-2xl border border-white/10 bg-black px-4 py-3 outline-none transition focus:border-blue-500"
                  placeholder="Room Code"
                  value={roomInput}
                  onChange={(e) => setRoomInput(e.target.value)}
                />

                <button
                  className="rounded-2xl bg-blue-600 px-5 py-3 font-semibold transition hover:bg-blue-500"
                  onClick={emitJoin}
                >
                  Join Room
                </button>
              </div>

              <p className="mt-4 text-sm text-zinc-400">
                {message}
              </p>
            </div>

            {/* VIDEO CONTROLS */}
            <div className="rounded-3xl border border-white/10 bg-zinc-950/80 p-5 shadow-2xl">

              <div className="flex flex-col gap-4 md:flex-row">

                <input
                  className="w-full rounded-2xl border border-white/10 bg-black px-4 py-3 outline-none transition focus:border-pink-500"
                  placeholder="Paste YouTube URL or Video ID"
                  value={videoInput}
                  onChange={(e) => setVideoInput(e.target.value)}
                  disabled={!canControl}
                />

                <button
                  className="rounded-2xl bg-pink-600 px-6 py-3 font-semibold transition hover:bg-pink-500 disabled:opacity-40"
                  disabled={!canControl}
                  onClick={changeVideo}
                >
                  Change Video
                </button>
              </div>

              <div className="mt-5 flex flex-wrap gap-3">

                <button
                  className="rounded-2xl bg-green-600 px-5 py-3 font-semibold transition hover:bg-green-500 disabled:opacity-40"
                  disabled={!canControl}
                  onClick={emitPlay}
                >
                  ▶ Play
                </button>

                <button
                  className="rounded-2xl bg-red-600 px-5 py-3 font-semibold transition hover:bg-red-500 disabled:opacity-40"
                  disabled={!canControl}
                  onClick={emitPause}
                >
                  ❚❚ Pause
                </button>
              </div>
            </div>

            {/* PLAYER */}
            <div className="overflow-hidden rounded-3xl border border-white/10 bg-black p-3 shadow-2xl">
              <div id="player" className="aspect-video w-full rounded-2xl overflow-hidden" />
            </div>
          </div>

          {/* PARTICIPANTS */}
          <div className="rounded-3xl border border-white/10 bg-zinc-950/80 p-5 shadow-2xl">

            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-xl font-bold">
                Participants
              </h2>

              <span className="rounded-full bg-zinc-800 px-3 py-1 text-xs">
                {participants.length}
              </span>
            </div>

            <div className="space-y-3">

              {participants.map((p) => (
                <div
                  key={p.userId}
                  className="rounded-2xl border border-white/10 bg-black/60 p-4"
                >
                  <div className="flex items-center justify-between">

                    <div>
                      <p className="font-semibold">
                        {p.username}{" "}
                        {p.userId === myUserId && (
                          <span className="text-purple-400">(You)</span>
                        )}
                      </p>

                      <p className="mt-1 text-sm capitalize text-zinc-400">
                        {p.role}
                      </p>
                    </div>
                  </div>

                  {myRole === ROLE.HOST &&
                    p.userId !== myUserId && (
                      <div className="mt-4 flex flex-wrap gap-2">

                        <button
                          className="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-medium transition hover:bg-indigo-500"
                          onClick={() =>
                            assignRole(p.userId, ROLE.MODERATOR)
                          }
                        >
                          Make Mod
                        </button>

                        <button
                          className="rounded-xl bg-zinc-700 px-3 py-2 text-sm font-medium transition hover:bg-zinc-600"
                          onClick={() =>
                            assignRole(
                              p.userId,
                              ROLE.PARTICIPANT
                            )
                          }
                        >
                          Participant
                        </button>

                        <button
                          className="rounded-xl bg-red-700 px-3 py-2 text-sm font-medium transition hover:bg-red-600"
                          onClick={() =>
                            removeParticipant(p.userId)
                          }
                        >
                          Remove
                        </button>
                      </div>
                    )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}