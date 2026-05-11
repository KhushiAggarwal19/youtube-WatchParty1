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
        videoId: "",
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
  <div className="min-h-screen bg-white text-black dark:bg-zinc-950 dark:text-white transition-colors duration-300">
    <div className="mx-auto max-w-7xl px-4 py-6">

      {/* HEADER */}
      <div className="mb-6 flex flex-col gap-4 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5">

        <div className="flex items-center justify-between">

          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              YouTube Watch Party
            </h1>

            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Watch videos together in real-time.
            </p>
          </div>

          {/* THEME BUTTON */}
          <button
            onClick={() =>
              document.documentElement.classList.toggle("dark")
            }
            className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm"
          >
            Toggle Theme
          </button>
        </div>

        <div className="flex flex-wrap gap-3 text-sm">

          <div className="rounded-lg bg-zinc-100 dark:bg-zinc-900 px-3 py-2">
            Room: {roomId || "Not Joined"}
          </div>

          <div className="rounded-lg bg-zinc-100 dark:bg-zinc-900 px-3 py-2 capitalize">
            Role: {myRole || "None"}
          </div>

          <div
            className={`rounded-lg px-3 py-2 ${
              backendReady
                ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
            }`}
          >
            {backendReady ? "Server Online" : "Connecting"}
          </div>
        </div>
      </div>

      {/* MAIN GRID */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">

        {/* LEFT SIDE */}
        <div className="space-y-6 lg:col-span-3">

          {/* PLAYER */}
          <div className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-black">
            <div
              id="player"
              className="aspect-video w-full"
            />
          </div>

          {/* CONTROLS */}
          <div className="grid gap-6 md:grid-cols-2">

            {/* ROOM */}
            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5">

              <h2 className="mb-4 text-lg font-semibold">
                Room Controls
              </h2>

              <div className="space-y-4">

                <input
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent px-4 py-3 outline-none"
                  placeholder="Your Name"
                  value={username}
                  onChange={(e) =>
                    setUsername(e.target.value)
                  }
                />

                <input
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent px-4 py-3 outline-none"
                  placeholder="Room Code"
                  value={roomInput}
                  onChange={(e) =>
                    setRoomInput(e.target.value)
                  }
                />

                <div className="flex gap-3">

                  <button
                    className="w-full rounded-lg bg-black text-white dark:bg-white dark:text-black py-3 text-sm font-medium"
                    onClick={emitCreate}
                  >
                    Create
                  </button>

                  <button
                    className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 py-3 text-sm font-medium"
                    onClick={emitJoin}
                  >
                    Join
                  </button>
                </div>

                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  {message}
                </p>
              </div>
            </div>

            {/* VIDEO */}
            <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5">

              <h2 className="mb-4 text-lg font-semibold">
                Video Controls
              </h2>

              <div className="space-y-4">

                <input
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent px-4 py-3 outline-none"
                  placeholder="Paste YouTube URL or ID"
                  value={videoInput}
                  onChange={(e) =>
                    setVideoInput(e.target.value)
                  }
                  disabled={!canControl}
                />

                <button
                  className="w-full rounded-lg bg-black text-white dark:bg-white dark:text-black py-3 text-sm font-medium disabled:opacity-40"
                  disabled={!canControl}
                  onClick={changeVideo}
                >
                  Change Video
                </button>

                <div className="grid grid-cols-2 gap-3">

                  <button
                    className="rounded-lg border border-zinc-300 dark:border-zinc-700 py-3 text-sm font-medium disabled:opacity-40"
                    disabled={!canControl}
                    onClick={emitPlay}
                  >
                    Play
                  </button>

                  <button
                    className="rounded-lg border border-zinc-300 dark:border-zinc-700 py-3 text-sm font-medium disabled:opacity-40"
                    disabled={!canControl}
                    onClick={emitPause}
                  >
                    Pause
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* PARTICIPANTS */}
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5 h-fit">

          <div className="mb-5 flex items-center justify-between">

            <h2 className="text-lg font-semibold">
              Participants
            </h2>

            <div className="rounded-lg bg-zinc-100 dark:bg-zinc-900 px-3 py-1 text-sm">
              {participants.length}
            </div>
          </div>

          <div className="space-y-3">

            {participants.map((p) => (
              <div
                key={p.userId}
                className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4"
              >

                <div className="flex items-center justify-between">

                  <div>
                    <p className="font-medium">
                      {p.username}

                      {p.userId === myUserId && (
                        <span className="ml-1 text-zinc-500">
                          (You)
                        </span>
                      )}
                    </p>

                    <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400 capitalize">
                      {p.role}
                    </p>
                  </div>

                  <div
                    className={`h-2.5 w-2.5 rounded-full ${
                      p.role === "host"
                        ? "bg-black dark:bg-white"
                        : p.role === "moderator"
                        ? "bg-zinc-500"
                        : "bg-zinc-300 dark:bg-zinc-700"
                    }`}
                  />
                </div>

                {myRole === ROLE.HOST &&
                  p.userId !== myUserId && (
                    <div className="mt-4 space-y-2">

                      <button
                        className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 py-2 text-sm"
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
                        className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 py-2 text-sm"
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
                        className="w-full rounded-lg border border-red-300 text-red-600 dark:border-red-700 dark:text-red-400 py-2 text-sm"
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
);};
