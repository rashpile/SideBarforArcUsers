import React from 'react';
import ReactDOM from 'react-dom/client';
import { NotePage } from './NotePage';
import { isValidNoteId } from '../utils/noteUrl';
import './note.css';

const noteId = new URLSearchParams(location.search).get('id');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <NotePage noteId={isValidNoteId(noteId) ? noteId : null} extensionOrigin={location.origin} />
  </React.StrictMode>,
);
