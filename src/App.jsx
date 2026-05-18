import React, { useEffect, useRef, useState } from 'react';
import * as Phaser from 'phaser';
import PlayScene from './game/scenes/PlayScene.js';

function App() {
  const gameRef = useRef(null);
  const [playerName, setPlayerName] = useState('');
  const [hasJoined, setHasJoined] = useState(false);
  const [nameError, setNameError] = useState('');
  const [selectedTankType, setSelectedTankType] = useState(5);
  const audioRef = useRef(null);
  const [returningFromDeath, setReturningFromDeath] = useState(false);

  const tankTypes = [
    { id: 1, name: 'Defender', icon: '🛡️', desc: 'High HP & Armor, Slow speed, Large size' },
    { id: 2, name: 'Speedster', icon: '⚡', desc: 'Fast speed, Small size, Low damage, Fast fire rate' },
    { id: 3, name: 'Destroyer', icon: '💥', desc: 'High damage, Fast bullet speed, Slow fire rate' },
    { id: 4, name: 'Healer', icon: '💚', desc: 'Fast regeneration, Fast fire rate' },
    { id: 5, name: 'Balanced', icon: '⚖️', desc: 'Balanced stats for all abilities' },
  ];

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
    window.__tankType = selectedTankType;
    
    // Stop menu music when joining game
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  };

  useEffect(() => {
    // Start menu music when component mounts
    if (!hasJoined && !audioRef.current) {
      audioRef.current = new Audio('/src/assets/menu_music.wav');
      audioRef.current.loop = true;
      audioRef.current.volume = 0.3;
      audioRef.current.play().catch(e => console.log('Audio play failed:', e));
    }

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

    // Check for return to menu signal
    const checkReturnToMenu = setInterval(() => {
      if (window.__returnToMenu) {
        window.__returnToMenu = false;
        setHasJoined(false);
        setReturningFromDeath(true);
        // Resume menu music
        if (audioRef.current) {
          audioRef.current.play().catch(e => console.log('Audio play failed:', e));
        }
      }
    }, 500);

    return () => {
      window.removeEventListener('resize', handleResize);
      clearInterval(checkReturnToMenu);
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
              {returningFromDeath ? 'YOU DIED' : 'TANK BATTLE.IO'}
            </h2>
            {!returningFromDeath && (
              <>
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
              </>
            )}
            {returningFromDeath && (
              <p
                style={{
                  fontSize: '14px',
                  color: '#aaaaaa',
                  textAlign: 'center',
                  marginBottom: '16px'
                }}
              >
                Playing as: <span style={{ color: '#00ff88', fontWeight: 'bold' }}>{playerName}</span>
              </p>
            )}
            <label
              style={{
                fontSize: '14px',
                color: '#cccccc',
                display: 'block',
                marginBottom: '8px'
              }}
            >
              Select Tank Type
            </label>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(5, 1fr)',
                gap: '8px',
                marginBottom: '16px'
              }}
            >
              {tankTypes.map((type) => (
                <div
                  key={type.id}
                  onClick={() => setSelectedTankType(type.id)}
                  style={{
                    padding: '10px 4px',
                    borderRadius: '6px',
                    border: `2px solid ${selectedTankType === type.id ? '#00ff88' : '#333355'}`,
                    background: selectedTankType === type.id ? '#0a2a1a' : '#0a0a1a',
                    cursor: 'pointer',
                    textAlign: 'center',
                    transition: 'all 0.2s'
                  }}
                  title={type.desc}
                >
                  <div style={{ fontSize: '24px', marginBottom: '4px' }}>{type.icon}</div>
                  <div style={{ fontSize: '11px', color: selectedTankType === type.id ? '#00ff88' : '#888888' }}>
                    {type.name}
                  </div>
                </div>
              ))}
            </div>
            <div
              style={{
                fontSize: '12px',
                color: '#888888',
                textAlign: 'center',
                marginBottom: '16px',
                minHeight: '32px'
              }}
            >
              {tankTypes.find(t => t.id === selectedTankType)?.desc}
            </div>
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
