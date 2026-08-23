import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './theme.css';
import { App } from './App';
import { RespondentApp } from './journey/RespondentApp';

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

// Respondents and operators are strictly separate surfaces: the respondent-
// facing journey app lives under /survey and never renders the admin portal.
const isRespondent = window.location.pathname.startsWith('/survey');

createRoot(root).render(<StrictMode>{isRespondent ? <RespondentApp /> : <App />}</StrictMode>);
