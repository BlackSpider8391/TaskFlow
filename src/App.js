import React, {useEffect, useState} from 'react';
import { Routes, Route } from 'react-router-dom';
import './styles/App.css';
import './styles/normal.css';
import Workflows from "./components/Workflow/Workflows"
import { useGeolocation } from './useGeolocation';
import { useGlobalStateContext } from './contexts/GlobalStateContext';
import { serverUrl } from './config';

function App() {
  const { address } = useGeolocation();
  const { globalState, updateGlobalState } = useGlobalStateContext();
  const [user, setUser] = useState();
  const [sessionId, setSessionId] = useState();

  useEffect(() => {
    if (address) {
      updateGlobalState({ address });
    }
  }, [address, updateGlobalState]);

  useEffect(() => {
    const fetchSession = async () => {
      try {
        const response = await fetch(`${serverUrl}api/session`, { credentials: 'include' });
        const data = await response.json();

        setUser(data.user);
        console.log("Set user: " + JSON.stringify(data.user));
        if (!globalState?.sessionId) {
          setSessionId(data.sessionId);
          console.log("Set sessionId ", data.sessionId);
        }
      } catch (err) {
        console.log(err.message);
      }
    };
    fetchSession();
  }, []);

  useEffect(() => {
    if (user) {
      updateGlobalState({ user });
    }
  }, [user, updateGlobalState]);

  useEffect(() => {
    if (sessionId) {
      updateGlobalState({ sessionId });
    }
  }, [sessionId, updateGlobalState]);

  return (
    <Routes>
      <Route exact path="/" element={<Workflows/>} />
      <Route path="/authenticated" element={<Workflows/>} />
    </Routes>
  );
}

export default App;
