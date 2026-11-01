import '@/app/app.css';

import React from 'react';
import ReactDOM from 'react-dom/client';

import { RemoteApp } from './remote-app';

const root = document.getElementById('root');
if (root === null) {
  throw new Error('Missing remote control root');
}
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <RemoteApp />
  </React.StrictMode>,
);
