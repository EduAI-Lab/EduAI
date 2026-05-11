/**
 * Animated floating letters SVG used for decorative background on the login page.
 * Randomly seeds characters and updates their positions over time for a subtle motion effect.
 */
import { useEffect, useState } from 'react';

interface Letter {
  id: number;
  char: string;
  x: number;
  y: number;
  size: number;
  speed: number;
  opacity: number;
}

interface FloatingLettersProps {
  /** Optional class for the container */
  className?: string;
  /** Optional class for each letter (e.g. text-slate-400 for dark backgrounds) */
  letterClassName?: string;
}

export function FloatingLetters({ className, letterClassName = 'text-primary' }: FloatingLettersProps = {}) {
  const [letters, setLetters] = useState<Letter[]>([]);

  useEffect(() => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*'.split('');
    const newLetters: Letter[] = Array.from({ length: 50 }, (_, i) => ({
      id: i,
      char: chars[Math.floor(Math.random() * chars.length)],
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * (2 - 0.8) + 0.8,
      speed: Math.random() * (8 - 4) + 4,
      opacity: Math.random() * (0.3 - 0.1) + 0.1
    }));

    setLetters(newLetters);

    const interval = setInterval(() => {
      setLetters(prev => prev.map(letter => ({
        ...letter,
        x: (letter.x + letter.speed * 0.1) % 100,
        y: (letter.y + Math.sin(letter.x / 10) * 0.5) % 100
      })));
    }, 50);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className={`fixed inset-0 overflow-hidden pointer-events-none ${className ?? ''}`}>
      {letters.map((letter) => (
        <div
          key={letter.id}
          className={`absolute transition-all duration-1000 ease-linear select-none ${letterClassName}`}
          style={{
            left: `${letter.x}%`,
            top: `${letter.y}%`,
            fontSize: `${letter.size}rem`,
            opacity: letter.opacity,
            transform: 'translate(-50%, -50%)'
          }}
        >
          {letter.char}
        </div>
      ))}
    </div>
  );
} 
