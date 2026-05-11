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
  <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-black to-zinc-900 text-white overflow-hidden">

    {/* BACKGROUND GLOW */}
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute top-[-120px] left-[-120px] h-[350px] w-[350px] rounded-full bg-red-600/20 blur-[140px]" />
      <div className="absolute bottom-[-100px] right-[-80px] h-[300px] w-[300px] rounded-full bg-blue-600/20 blur-[140px]" />
    </div>

    <div className="relative z-10 mx-auto max-w-7xl px-4 py-8">

      {/* TOP BAR */}
      <div className="mb-8 flex flex-col gap-5 rounded-[32px] border border-white/10 bg-white/5 p-6 backdrop-blur-2xl lg:flex-row lg:items-center lg:justify-between">

        <div>
          <h1 className="text-4xl font-black tracking-tight md:text-5xl">
            YouTube Watch Party
          </h1>

          <p className="mt-2 text-sm text-zinc-400">
            Stream together • Sync together • Watch together
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">

          <div className="rounded-2xl border border-white/10 bg-black/40 px-5 py-4">
            <p className="text-xs uppercase tracking-wider text-zinc-500">
              Room
            </p>

            <p className="mt-1 font-semibold">
              {roomId || "Not Joined"}
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/40 px-5 py-4">
            <p className="text-xs uppercase tracking-wider text-zinc-500">
              Role
            </p>

            <p className="mt-1 font-semibold capitalize">
              {myRole || "None"}
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/40 px-5 py-4">
            <p className="text-xs uppercase tracking-wider text-zinc-500">
              Server
            </p>

            <p
              className={`mt-1 font-semibold ${
                backendReady
                  ? "text-green-400"
                  : "text-yellow-400"
              }`}
            >
              {backendReady ? "Online" : "Warming"}
            </p>
          </div>
        </div>
      </div>

      {/* MAIN GRID */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">

        {/* LEFT SIDE */}
        <div className="space-y-6 xl:col-span-9">

          {/* WATCH PLAYER */}
          <div className="overflow-hidden rounded-[34px] border border-white/10 bg-black shadow-[0_0_40px_rgba(0,0,0,0.5)]">

            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">

              <div className="flex items-center gap-3">
                <div className="h-3 w-3 rounded-full bg-red-500" />
                <div className="h-3 w-3 rounded-full bg-yellow-500" />
                <div className="h-3 w-3 rounded-full bg-green-500" />
              </div>

              <p className="text-sm text-zinc-400">
                Synchronized Streaming
              </p>
            </div>

            <div className="p-3">
              <div
                id="player"
                className="aspect-video w-full overflow-hidden rounded-[24px]"
              />
            </div>
          </div>

          {/* CONTROLS */}
          <div className="grid gap-6 lg:grid-cols-2">

            {/* ROOM PANEL */}
            <div className="rounded-[28px] border border-white/10 bg-white/5 p-6 backdrop-blur-xl">

              <h2 className="mb-5 text-xl font-bold">
                Room Controls
              </h2>

              <div className="space-y-4">

                <input
                  className="w-full rounded-2xl border border-white/10 bg-black/50 px-4 py-3 outline-none transition focus:border-red-500"
                  placeholder="Enter your name"
                  value={username}
                  onChange={(e) =>
                    setUsername(e.target.value)
                  }
                />

                <div className="flex gap-3">

                  <button
                    className="w-full rounded-2xl bg-red-600 px-5 py-3 font-semibold transition hover:bg-red-500"
                    onClick={emitCreate}
                  >
                    Create Room
                  </button>

                  <button
                    className="w-full rounded-2xl bg-blue-600 px-5 py-3 font-semibold transition hover:bg-blue-500"
                    onClick={emitJoin}
                  >
                    Join Room
                  </button>
                </div>

                <input
                  className="w-full rounded-2xl border border-white/10 bg-black/50 px-4 py-3 outline-none transition focus:border-blue-500"
                  placeholder="Enter room code"
                  value={roomInput}
                  onChange={(e) =>
                    setRoomInput(e.target.value)
                  }
                />

                <div className="rounded-2xl border border-white/10 bg-black/40 p-4 text-sm text-zinc-400">
                  {message}
                </div>
              </div>
            </div>

            {/* VIDEO CONTROLS */}
            <div className="rounded-[28px] border border-white/10 bg-white/5 p-6 backdrop-blur-xl">

              <h2 className="mb-5 text-xl font-bold">
                Playback Controls
              </h2>

              <div className="space-y-4">

                <input
                  className="w-full rounded-2xl border border-white/10 bg-black/50 px-4 py-3 outline-none transition focus:border-pink-500"
                  placeholder="Paste YouTube link or video ID"
                  value={videoInput}
                  onChange={(e) =>
                    setVideoInput(e.target.value)
                  }
                  disabled={!canControl}
                />

                <button
                  className="w-full rounded-2xl bg-pink-600 px-5 py-3 font-semibold transition hover:bg-pink-500 disabled:opacity-40"
                  disabled={!canControl}
                  onClick={changeVideo}
                >
                  Change Video
                </button>

                <div className="grid grid-cols-2 gap-3">

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
            </div>
          </div>
        </div>

        {/* RIGHT PANEL */}
        <div className="xl:col-span-3">

          <div className="sticky top-6 rounded-[30px] border border-white/10 bg-white/5 p-5 backdrop-blur-xl">

            <div className="mb-5 flex items-center justify-between">

              <div>
                <h2 className="text-2xl font-bold">
                  Participants
                </h2>

                <p className="mt-1 text-sm text-zinc-400">
                  Live room members
                </p>
              </div>

              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-600 font-bold">
                {participants.length}
              </div>
            </div>

            <div className="space-y-4">

              {participants.map((p) => (
                <div
                  key={p.userId}
                  className="rounded-2xl border border-white/10 bg-black/40 p-4"
                >

                  <div className="flex items-start justify-between">

                    <div>
                      <h3 className="font-semibold">
                        {p.username}

                        {p.userId === myUserId && (
                          <span className="ml-2 text-sm text-red-400">
                            (You)
                          </span>
                        )}
                      </h3>

                      <p className="mt-1 text-sm capitalize text-zinc-400">
                        {p.role}
                      </p>
                    </div>

                    <div
                      className={`h-3 w-3 rounded-full ${
                        p.role === "host"
                          ? "bg-red-500"
                          : p.role === "moderator"
                          ? "bg-blue-500"
                          : "bg-zinc-500"
                      }`}
                    />
                  </div>

                  {myRole === ROLE.HOST &&
                    p.userId !== myUserId && (
                      <div className="mt-4 space-y-2">

                        <button
                          className="w-full rounded-xl bg-indigo-600 px-3 py-2 text-sm font-medium transition hover:bg-indigo-500"
                          onClick={() =>
                            assignRole(
                              p.userId,
                              ROLE.MODERATOR
                            )
                          }
                        >
                          Make Moderator
                        </button>

                        <button
                          className="w-full rounded-xl bg-zinc-700 px-3 py-2 text-sm font-medium transition hover:bg-zinc-600"
                          onClick={() =>
                            assignRole(
                              p.userId,
                              ROLE.PARTICIPANT
                            )
                          }
                        >
                          Make Participant
                        </button>

                        <button
                          className="w-full rounded-xl bg-red-700 px-3 py-2 text-sm font-medium transition hover:bg-red-600"
                          onClick={() =>
                            removeParticipant(p.userId)
                          }
                        >
                          Remove User
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
  </div>
)};