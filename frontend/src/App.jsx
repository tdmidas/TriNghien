import React, { useEffect, useState } from "react";
import Home from "./components/Home.jsx";
import Workspace from "./components/Workspace.jsx";

// Tiny hash router: #/p/<id> opens the workspace, otherwise home.
export default function App() {
  const [route, setRoute] = useState(parseHash());

  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  if (route.name === "project")
    return <Workspace projectId={route.id} onHome={() => (window.location.hash = "")} />;
  return <Home onOpen={(id) => (window.location.hash = `/p/${id}`)} />;
}

function parseHash() {
  const m = window.location.hash.match(/#\/p\/([a-z0-9]+)/i);
  return m ? { name: "project", id: m[1] } : { name: "home" };
}
