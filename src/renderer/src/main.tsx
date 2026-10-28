import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import 'misans/lib/Normal/MiSansVF.min.css'
import './styles/tokens.css'
import './app.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
