import React, { useEffect, useRef, useState } from 'react';
import * as Phaser from 'phaser';
import PlayScene from './game/scenes/PlayScene.js';

function App() {
  const gameRef = useRef(null);
  const [playerName, setPlayerName] = useState('');
  const [hasJoined, setHasJoined] = useState(false);
  const [nameError, setNameError] = useState('');

  const handlePlay = () => {
    const name = playerName.trim();
    if (!name) {
      setNameError('Please enter your name.');
      return;
    }
    if (!/^[A-Za-z0-9_-]{1,10}$/.test(name)) {
      setNameError('Name must be 1-10 characters. Letters, numbers, _ or - only.');
      return;
    }
    setNameError('');
    setHasJoined(true);
    window.__playerName = name;
  };

  useEffect(() => {
    if (!hasJoined) return;

    const width = window.innerWidth;
    const height = window.innerHeight;

    const config = {
      type: Phaser.AUTO,
      parent: 'phaser-game',
      width,
      height,
      backgroundColor: '#1a1a2e',
      scene: PlayScene,
      physics: {
        default: 'arcade',
        arcade: {
          gravity: { y: 0 },
          debug: false
        }
      },
      disableVisibilityChange: true,
      pauseOnBlur: false,
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH
      }
    };

    gameRef.current = new Phaser.Game(config);

    const handleResize = () => {
      if (gameRef.current) {
        gameRef.current.scale.resize(window.innerWidth, window.innerHeight);
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
    };
  }, [hasJoined]);

  return (
    <>
      {!hasJoined && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            fontFamily: 'Arial, sans-serif'
          }}
        >
          <div
            style={{
              background: '#111122',
              padding: '36px 28px',
              borderRadius: '12px',
              boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
              color: '#ffffff',
              minWidth: '320px'
            }}
          >
            <h2
              style={{
                margin: '0 0 18px 0',
                fontSize: '24px',
                textAlign: 'center',
                color: '#00ff88',
                fontWeight: 'bold'
              }}
            >
              TANK BATTLE.IO
            </h2>
            <label
              style={{
                fontSize: '14px',
                color: '#cccccc',
                display: 'block',
                marginBottom: '8px'
              }}
            >
              Ingame Name
            </label>
            <input
              autoFocus
              value={playerName}
              onChange={(e) => {
                setPlayerName(e.target.value);
                if (nameError) setNameError('');
              }}
              placeholder="Enter your name..."
              onKeyDown={(e) => {
                if (e.key === 'Enter') handlePlay();
              }}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '10px 12px',
                borderRadius: '6px',
                border: `1px solid ${nameError ? '#ff4444' : '#333355'}`,
                background: '#0a0a1a',
                color: '#ffffff',
                fontSize: '16px',
                outline: 'none',
                marginBottom: nameError ? '6px' : '16px'
              }}
            />
            {nameError && (
              <p style={{ color: '#ff6666', fontSize: '13px', margin: '0 0 14px 0' }}>{nameError}</p>
            )}
            <button
              onClick={handlePlay}
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '6px',
                border: 'none',
                background: '#00ff88',
                color: '#000000',
                fontSize: '16px',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              Play
            </button>
          </div>
        </div>
      )}
      <div
        id="phaser-game"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          overflow: 'hidden',
          background: '#0a0a1a',
          display: hasJoined ? 'block' : 'none'
        }}
      ></div>
    </>
  );
}

export default App;
