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
  <div className="min-h-screen bg-zinc-950 text-white px-4 py-6">
    <div className="mx-auto max-w-7xl">

      {/* HEADER */}
      <div className="mb-6 border border-zinc-800 bg-zinc-900 rounded-xl p-5">
        <h1 className="text-3xl font-bold">
          YouTube Watch Party
        </h1>

        <p className="mt-2 text-sm text-zinc-400">
          Watch YouTube videos together in sync.
        </p>

        <div className="mt-4 flex flex-wrap gap-3 text-sm">

          <div className="bg-zinc-800 px-3 py-2 rounded-lg">
            Room: {roomId || "Not Joined"}
          </div>

          <div className="bg-zinc-800 px-3 py-2 rounded-lg capitalize">
            Role: {myRole || "None"}
          </div>

          <div
            className={`px-3 py-2 rounded-lg ${
              backendReady
                ? "bg-green-700"
                : "bg-yellow-700"
            }`}
          >
            {backendReady ? "Server Online" : "Warming Server"}
          </div>
        </div>
      </div>

      {/* MAIN SECTION */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">

        {/* LEFT */}
        <div className="lg:col-span-3 space-y-6">

          {/* PLAYER */}
          <div className="border border-zinc-800 bg-black rounded-xl overflow-hidden">
            <div
              id="player"
              className="aspect-video w-full"
            />
          </div>

          {/* ROOM CONTROLS */}
          <div className="border border-zinc-800 bg-zinc-900 rounded-xl p-5">

            <h2 className="text-xl font-semibold mb-4">
              Room Controls
            </h2>

            <div className="grid md:grid-cols-2 gap-4">

              <input
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-4 py-3 outline-none"
                placeholder="Your Name"
                value={username}
                onChange={(e) =>
                  setUsername(e.target.value)
                }
              />

              <input
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-4 py-3 outline-none"
                placeholder="Room Code"
                value={roomInput}
                onChange={(e) =>
                  setRoomInput(e.target.value)
                }
              />
            </div>

            <div className="mt-4 flex gap-3">

              <button
                className="bg-red-600 hover:bg-red-500 px-5 py-3 rounded-lg font-medium"
                onClick={emitCreate}
              >
                Create Room
              </button>

              <button
                className="bg-blue-600 hover:bg-blue-500 px-5 py-3 rounded-lg font-medium"
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
          <div className="border border-zinc-800 bg-zinc-900 rounded-xl p-5">

            <h2 className="text-xl font-semibold mb-4">
              Video Controls
            </h2>

            <input
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-4 py-3 outline-none"
              placeholder="Paste YouTube URL or Video ID"
              value={videoInput}
              onChange={(e) =>
                setVideoInput(e.target.value)
              }
              disabled={!canControl}
            />

            <div className="mt-4 flex flex-wrap gap-3">

              <button
                className="bg-pink-600 hover:bg-pink-500 px-5 py-3 rounded-lg font-medium disabled:opacity-40"
                disabled={!canControl}
                onClick={changeVideo}
              >
                Change Video
              </button>

              <button
                className="bg-green-600 hover:bg-green-500 px-5 py-3 rounded-lg font-medium disabled:opacity-40"
                disabled={!canControl}
                onClick={emitPlay}
              >
                Play
              </button>

              <button
                className="bg-red-600 hover:bg-red-500 px-5 py-3 rounded-lg font-medium disabled:opacity-40"
                disabled={!canControl}
                onClick={emitPause}
              >
                Pause
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT SIDE */}
        <div className="border border-zinc-800 bg-zinc-900 rounded-xl p-5 h-fit">

          <div className="flex items-center justify-between mb-5">

            <h2 className="text-xl font-semibold">
              Participants
            </h2>

            <div className="bg-zinc-800 px-3 py-1 rounded-lg text-sm">
              {participants.length}
            </div>
          </div>

          <div className="space-y-4">

            {participants.map((p) => (
              <div
                key={p.userId}
                className="bg-zinc-950 border border-zinc-800 rounded-lg p-4"
              >

                <div className="flex items-center justify-between">

                  <div>
                    <p className="font-medium">
                      {p.username}

                      {p.userId === myUserId && (
                        <span className="text-red-400 ml-1">
                          (You)
                        </span>
                      )}
                    </p>

                    <p className="text-sm text-zinc-400 capitalize mt-1">
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
                        className="w-full bg-blue-600 hover:bg-blue-500 py-2 rounded-lg text-sm"
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
                        className="w-full bg-zinc-700 hover:bg-zinc-600 py-2 rounded-lg text-sm"
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
                        className="w-full bg-red-700 hover:bg-red-600 py-2 rounded-lg text-sm"
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