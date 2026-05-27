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
        <div className="menu-container">
          <div className="menu-panel">
            <h2 className="menu-title">
              {returningFromDeath ? 'YOU DIED' : 'TANK BATTLE.IO'}
            </h2>
            {!returningFromDeath && (
              <>
                <label className="menu-label">
                  Ingame Name
                </label>
                <input
                  autoFocus
                  className={`menu-input ${nameError ? 'error' : ''}`}
                  value={playerName}
                  onChange={(e) => {
                    setPlayerName(e.target.value);
                    if (nameError) setNameError('');
                  }}
                  placeholder="Enter your name..."
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handlePlay();
                  }}
                />
                {nameError && (
                  <p className="error-message">{nameError}</p>
                )}
              </>
            )}
            {returningFromDeath && (
              <p className="tank-description">
                Playing as: <span style={{ color: '#00F5FF', fontWeight: 'bold' }}>{playerName}</span>
              </p>
            )}
            <label className="menu-label">
              Select Tank Type
            </label>
            <div className="tank-selection-grid">
              {tankTypes.map((type) => (
                <div
                  key={type.id}
                  className={`tank-option ${selectedTankType === type.id ? 'selected' : ''}`}
                  onClick={() => setSelectedTankType(type.id)}
                  title={type.desc}
                >
                  <div className="tank-icon">{type.icon}</div>
                  <div className="tank-name">
                    {type.name}
                  </div>
                </div>
              ))}
            </div>
            <div className="tank-description">
              {tankTypes.find(t => t.id === selectedTankType)?.desc}
            </div>
            <button
              className="play-button"
              onClick={handlePlay}
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
