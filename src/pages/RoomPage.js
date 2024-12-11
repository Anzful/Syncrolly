// src/pages/RoomPage.jsx

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useLocation, Link } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import socket from '../socket';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { EditorView } from '@codemirror/view';
import debounce from 'lodash.debounce';
import styles from './RoomPage.module.css';
import FilesModal from './FilesModal';
import '@fortawesome/fontawesome-free/css/all.min.css';

function RoomPage() {
  const { roomId } = useParams();
  const location = useLocation();
  const initialIsCreator = location.state?.isCreator || false;
  const [isCreator, setIsCreator] = useState(initialIsCreator);
  const [filesModalVisible, setFilesModalVisible] = useState(false);
  const storedUserId = localStorage.getItem('userId') || uuidv4();
  const storedUserName = localStorage.getItem('userName') || '';
  const storedTheme = localStorage.getItem('theme') || 'light';

  if (!localStorage.getItem('userId')) {
    localStorage.setItem('userId', storedUserId);
  }
  console.log('Room ID:', roomId);

  const [userName, setUserName] = useState(storedUserName);
  const [isNameSet, setIsNameSet] = useState(!!storedUserName);
  const [code, setCode] = useState('');
  const [messages, setMessages] = useState([]);
  const [chatVisible, setChatVisible] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [theme, setTheme] = useState(storedTheme);
  const [typingUsers, setTypingUsers] = useState([]);
  const [files, setFiles] = useState([]);
  const [fileInput, setFileInput] = useState(null);
  const [isEditable, setIsEditable] = useState(false);
  const [loading, setLoading] = useState(isNameSet);

  const typingTimeoutRef = useRef(null);
  const [isTyping, setIsTyping] = useState(false);

  const backendUrl = process.env.REACT_APP_BACKEND_URL;
console.log(backendUrl); // 

  useEffect(() => {
    if (!isNameSet) {
      setLoading(false);
    }
  }, [isNameSet]);

  const extensions = useMemo(() => [
    javascript(),
    EditorView.lineWrapping,
    EditorView.editable.of(isEditable || isCreator),
  ], [isEditable, isCreator]);

  useEffect(() => {
    // Listen for changes in editability from the backend
    socket.on('editable_state_changed', ({ isEditable: newIsEditable }) => {
      console.log('Editable state changed:', newIsEditable);
      setIsEditable(newIsEditable);
    });

    // Listen for file deletion events
    socket.on('file_deleted', (fileId) => {
      setFiles((prevFiles) => prevFiles.filter((file) => file._id !== fileId));
    });

    return () => {
      socket.off('editable_state_changed');
      socket.off('file_deleted');
    };
  }, []);

  useEffect(() => {
    if (isNameSet) {
      setLoading(true);
      console.log('Attempting to join room with:', { roomId, userName: storedUserName, userId: storedUserId, isCreator });
      socket.emit('join_room', { roomId, userName: storedUserName, userId: storedUserId, isCreator }, (response) => {
        console.log('join_room response:', response);
        if (response.error) {
          alert(response.error);
          setLoading(false);
          return;
        }
        if (response.success) {
          console.log('Joined room successfully:', response);
          setFiles(response.files);
          setCode(response.text);
          setMessages(response.messages);
          setIsEditable(response.isEditable);
          setIsCreator(response.isCreator);
          console.log('Initial isEditable state:', response.isEditable);
          setLoading(false);
        }
      });

      // Listen for new files
      socket.on('new_file', (newFile) => {
        setFiles((prevFiles) => [...prevFiles, newFile]);
      });

      // Listen for text updates
      socket.on('update_text', (text) => setCode(text));

      // Listen for incoming chat messages
      socket.on('receive_message', (message) => setMessages((prev) => [...prev, message]));

      // Listen for typing indicators
      socket.on('user_typing', (data) => {
        setTypingUsers((prev) => {
          const userExists = prev.some((user) => user.userId === data.userId);
          if (userExists) {
            return prev;
          }
          return [...prev, data];
        });
      });

      socket.on('user_stopped_typing', (data) => {
        setTypingUsers((prev) => prev.filter((user) => user.userId !== data.userId));
      });

      return () => {
        socket.off('new_file');
        socket.off('update_text');
        socket.off('receive_message');
        socket.off('user_typing');
        socket.off('user_stopped_typing');
      };
    }
  }, [isNameSet, roomId, storedUserName, storedUserId, isCreator]);

  // Debounced code change handler
  const debouncedCodeChange = useMemo(() => debounce((newCode) => {
    if (isEditable || isCreator) {
      setCode(newCode);
      socket.emit('send_text', { roomId, text: newCode });
    }
  }, 300), [isEditable, isCreator, roomId]);

  // Function to handle setting the user name
  const handleNameSubmit = () => {
    if (userName.trim()) {
      console.log('Setting user name:', userName);
      localStorage.setItem('userName', userName);
      setIsNameSet(true);
    } else {
      alert('Please enter a valid name.');
    }
  };

  // Function to toggle room editability
  const handleEditableToggle = () => {
    if (!isCreator) return;
    socket.emit('toggle_editability', { roomId, userId: storedUserId });
  };

  // Function to send chat messages
  const handleSendMessage = () => {
    if (!chatInput.trim()) return;
    socket.emit('send_message', { roomId, userId: storedUserId, message: chatInput });
    setChatInput('');
  };

  // Function to upload files
  const handleFileUpload = async () => {
    if (!fileInput) {
      alert('Please select a file to upload.');
      return;
    }

    const formData = new FormData();
    formData.append('file', fileInput);
    formData.append('userId', storedUserId);

    try {
      const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/upload/${roomId}`, {
        method: 'POST',
        body: formData,
      });
      

      const responseText = await response.text();
      try {
        const data = response.ok ? JSON.parse(responseText) : null;

        if (response.ok) {
          setFiles((prevFiles) => {
            if (!prevFiles.some((file) => file.fileUrl === data.fileUrl)) {
              return [...prevFiles, data];
            }
            return prevFiles;
          });

          socket.emit('new_file', data);
          alert('File uploaded successfully');
        } else {
          alert('Upload failed: ' + responseText);
        }
      } catch (jsonError) {
        console.error('JSON parsing error:', jsonError);
        alert('Server response was not in JSON format. Raw response: ' + responseText);
      }
    } catch (error) {
      console.error('Upload error:', error);
      alert('File upload failed: ' + error.message);
    }
  };

  // Function to delete files
  const handleDeleteFile = async (fileId) => {
    try {
      const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/delete_file/${roomId}/${fileId}`, {
        method: 'DELETE',
      });
      
  
      const responseText = await response.text();
      console.log('Raw server response:', responseText);
  
      try {
        const data = response.ok ? JSON.parse(responseText) : null;
  
        if (response.ok) {
          alert('File deleted successfully');
          setFiles((prevFiles) => prevFiles.filter(file => file._id !== fileId));
        } else {
          const errorData = JSON.parse(responseText);
          alert(errorData.error || 'Failed to delete file');
        }
      } catch (jsonError) {
        console.error('JSON parsing error:', jsonError);
        alert('Server response was not in valid JSON format. Raw response: ' + responseText);
      }
    } catch (error) {
      console.error('Error deleting file:', error);
      alert('Error deleting file: ' + error.message);
    }
  };
  

  // Function to toggle theme
  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    socket.emit('change_theme', { roomId, theme: newTheme });
  };



  // Function to toggle chat box visibility
  const toggleChatBox = () => {
    setChatVisible(!chatVisible);
  };

  // Define the handleTypingStart and handleTypingStop functions
  const handleTypingStart = () => {
    if (!isTyping) {
      socket.emit('typing_start', { roomId, userId: storedUserId, userName });
      setIsTyping(true);
    }

    // Clear existing timeout to reset the debounce timer
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    // Set a new timeout to emit 'typing_stop' after 3 seconds of inactivity
    typingTimeoutRef.current = setTimeout(() => {
      handleTypingStop();
    }, 3000);
  };

  const handleTypingStop = () => {
    if (isTyping) {
      socket.emit('typing_stop', { roomId, userId: storedUserId });
      setIsTyping(false);
    }

    // Clear the timeout to prevent unnecessary 'typing_stop' emissions
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
  };

  return loading ? (
    <div className={styles['loading-container']}>
      <div className={styles['spinner']}></div>
      <p>Loading...</p>
    </div>
  ) : (
    <div className={`${styles['room-container']} ${styles[theme]}`}>
      {!isNameSet ? (
        <div className={styles['name-setup']}>
          <h1>Welcome to Room: {roomId}</h1>
          <p>Please enter your name to join the room:</p>
          <input
            type="text"
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            className={styles['name-input']}
          />
          <button onClick={handleNameSubmit} className={styles['submit-btn']}>
            Set Name
          </button>
        </div>
      ) : (
        <>
          <div className={styles['header']}>
            <div className={styles['logo-container']}>
              <Link to="/">
                <img
                  src={require('../assets/syncrolly-logo.png')}
                  alt="Syncrolly Logo"
                  className={styles['syncrolly-logo']}
                />
              </Link>
            </div>
            <h1>Room: {roomId}</h1>
            {isCreator && (
              <button onClick={handleEditableToggle} className={`${styles['toggle-btn']} ${isEditable ? 'editable' : 'viewOnly'}`}>
                <span className="icon"></span>
                {isEditable ? "Set to View-Only" : "Make Editable"}
              </button>
            )}

            <div className={styles['chat-toggle']}>
              <button onClick={toggleChatBox} className={styles['chat-btn']}>
                {chatVisible ? 'Close Chat' : 'Open Chat'}
              </button>
              <button onClick={() => setFilesModalVisible(true)} className={styles['files-btn']}>
                View Files
              </button>
            </div>

            {/* Single Theme Toggle Button */}
            <div className={styles['theme-toggle']}>
              <button onClick={toggleTheme} className={styles['theme-btn']} aria-label="Toggle Theme">
                {/* Icon changes based on current theme */}
                {theme === 'light' ? (
                  <i className="fas fa-moon"></i>
                ) : (
                  <i className="fas fa-sun"></i>
                )}
              </button>
            </div>
          </div>

          <div className={styles['main-content']}>
            <CodeMirror
              value={code}
              extensions={extensions}
              onChange={(value) => {
                debouncedCodeChange(value);
                handleTypingStart(); // Invoke handleTypingStart on every change
              }}
              onBlur={handleTypingStop} // Invoke handleTypingStop when the editor loses focus
              className={`${styles['code-editor']} ${styles[theme]}`}
            />
          </div>

          <div className={styles['typing-indicator']}>
            {typingUsers.length > 0 && (
              <p>
                {typingUsers.map((user) => user.userName).join(', ')}{' '}
                {typingUsers.length > 1 ? 'are' : 'is'} typing...
              </p>
            )}
          </div>

          <div className={`${styles['chat-box']} ${chatVisible ? styles['open'] : ''} ${styles[theme]}`}>
            <button onClick={toggleChatBox} className={styles['close-btn']}>
              X
            </button>
            <div className={styles['messages']}>
              {messages.map((msg, index) => (
                <div key={index} className={styles['message']}>
                  <strong>{msg.userName}:</strong> {msg.text}
                </div>
              ))}
            </div>
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              className={styles['chat-input']}
              onFocus={handleTypingStart}  // Start typing when input gains focus
              onBlur={handleTypingStop}    // Stop typing when input loses focus
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSendMessage();
                }
              }}
            />
            <button onClick={handleSendMessage} className={styles['send-btn']}>
              Send
            </button>
          </div>

          {filesModalVisible && (
            <FilesModal
              files={files}
              fileInput={fileInput}
              setFileInput={setFileInput}
              handleFileUpload={handleFileUpload}
              handleDeleteFile={handleDeleteFile}
              onClose={() => setFilesModalVisible(false)}
            />
          )}
        </>
      )}
      <footer className={styles['footer']}>
        <div className={styles['footer-content']}>
          <p>&copy; 2024 <strong>LGA Corporation</strong>. All rights reserved.</p>
          <p>
            Contact us on{' '}
            <a 
              href="https://www.instagram.com/syncrolly/" 
              target="_blank" 
              rel="noopener noreferrer" 
              className={styles['contact-link']}
              aria-label="Visit Syncrolly's Instagram profile"
            >
              Instagram
              <i className="fab fa-instagram" style={{ marginLeft: '8px' }}></i>
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}

export default RoomPage;
