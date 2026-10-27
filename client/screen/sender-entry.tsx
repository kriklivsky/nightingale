import './style.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { documentLanguage, messages } from './messages';
import { ScreenSender } from './sender';

document.documentElement.lang = documentLanguage;
document.title = messages.pageTitle;

const root = document.getElementById('root');
if (root === null) {
  throw new Error('Missing application root');
}
const queryClient = new QueryClient();
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ScreenSender />
    </QueryClientProvider>
  </StrictMode>,
);
