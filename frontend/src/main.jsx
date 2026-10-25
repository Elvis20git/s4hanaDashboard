import { createRoot } from 'react-dom/client';
import './styles/index.css';
import './styles/auth.css';
import './styles/admin.css';
import App from './App.jsx';
import { AuthGate } from './auth/AuthGate.jsx';

createRoot(document.getElementById('root')).render(<AuthGate><App /></AuthGate>);
