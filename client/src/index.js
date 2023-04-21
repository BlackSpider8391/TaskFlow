import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/index.css';
import App from './App';
import { WebSocketProvider } from './contexts/WebSocketContext';
import { GlobalStateProvider } from './contexts/GlobalStateContext'
import { socketUrl } from './config';
import { BrowserRouter as Router } from 'react-router-dom';
    
function Root() {
 
    // <React.StrictMode> was causing issues with double loading
    return (
        <GlobalStateProvider>
            <WebSocketProvider socketUrl={socketUrl}>
                <Router>
                    <App/>
                </Router>
            </WebSocketProvider>
        </GlobalStateProvider>
    )
}

const rootElement = document.getElementById('root');
ReactDOM.createRoot(rootElement).render(<Root />);