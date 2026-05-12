/**
 * Dual-handle range slider component used for adjusting percentage boundaries.
 * Includes historical notes on reasoning/difficulty calculations retained for reference.
 */
import React, { useState, useRef, useEffect } from 'react';

/**
 * REASONING STATE CALCULATIONS (Previously used in GenerateAssessmentModal)
 * 
 * This component was used in a Reasoning × Difficulty Distribution Matrix.
 * Below are the calculations that were used to manage the reasoning state:
 * 
 * 1. REASONING DATA STATE STRUCTURE:
 *    Each reasoning type (factual, analytical, application) has:
 *    - total: Total percentage for this reasoning type (0-100)
 *    - easyBoundary: Boundary between Easy and Medium (0-100)
 *    - hardBoundary: Boundary between Medium and Hard (0-100)
 * 
 *    Example state:
 *    const [reasoningData, setReasoningData] = useState({
 *      factual: { total: 40, easyBoundary: 60, hardBoundary: 90 },
 *      analytical: { total: 35, easyBoundary: 50, hardBoundary: 80 },
 *      application: { total: 25, easyBoundary: 40, hardBoundary: 70 }
 *    });
 * 
 * 2. REASONING DISTRIBUTIONS CALCULATION:
 *    Converts boundaries to difficulty percentages for each reasoning type:
 *    - easy = easyBoundary
 *    - medium = hardBoundary - easyBoundary
 *    - hard = 100 - hardBoundary
 * 
 *    Example:
 *    const reasoningDistributions = {
 *      factual: {
 *        easy: 60,      // easyBoundary
 *        medium: 30,    // 90 - 60
 *        hard: 10       // 100 - 90
 *      },
 *      // ... same for analytical and application
 *    };
 * 
 * 3. OVERALL TOTALS CALCULATION:
 *    Combines all reasoning types weighted by their totals:
 *    - totalWeight = sum of all reasoning type totals
 *    - easy = weighted average: (factual.total * factual.easy + analytical.total * analytical.easy + application.total * application.easy) / totalWeight
 *    - medium = same calculation for medium
 *    - hard = same calculation for hard
 * 
 *    Example:
 *    const overallTotals = {
 *      easy: Math.round((40 * 60 + 35 * 50 + 25 * 40) / 100),  // weighted average
 *      medium: Math.round((40 * 30 + 35 * 30 + 25 * 30) / 100),
 *      hard: Math.round((40 * 10 + 35 * 20 + 25 * 30) / 100),
 *      total: 100
 *    };
 * 
 * 4. AUTO-BALANCE FUNCTION (updateReasoningTotal):
 *    When one reasoning type total changes, automatically adjusts others proportionally:
 *    - Calculate remaining total = 100 - newTotal
 *    - Find scale factor = remainingTotal / sum of other totals
 *    - Scale all other reasoning type totals by the scale factor
 * 
 *    Example: If factual.total changes from 40 to 50:
 *    - remainingTotal = 100 - 50 = 50
 *    - otherTotal = 35 + 25 = 60
 *    - scaleFactor = 50 / 60 = 0.833
 *    - analytical.total = 35 * 0.833 = 29
 *    - application.total = 25 * 0.833 = 21
 */

interface DualRangeSliderProps {
  min: number;
  max: number;
  easyBoundary: number; // Left handle - boundary between Easy and Medium
  hardBoundary: number; // Right handle - boundary between Medium and Hard
  onChange: (easyBoundary: number, hardBoundary: number) => void;
  step?: number;
  className?: string;
}

export const DualRangeSlider: React.FC<DualRangeSliderProps> = ({
  min,
  max,
  easyBoundary,
  hardBoundary,
  onChange,
  step = 1,
  className = ''
}) => {
  const [isDragging, setIsDragging] = useState<'easy' | 'hard' | null>(null);
  const sliderRef = useRef<HTMLDivElement>(null);

  const getPercentage = (value: number) => {
    return ((value - min) / (max - min)) * 100;
  };

  const getValueFromPercentage = (percentage: number) => {
    return Math.round((percentage / 100) * (max - min) + min);
  };

  const handleMouseDown = (e: React.MouseEvent, type: 'easy' | 'hard') => {
    e.preventDefault();
    setIsDragging(type);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging || !sliderRef.current) return;

    const rect = sliderRef.current.getBoundingClientRect();
    const percentage = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const newValue = getValueFromPercentage(percentage);

    if (isDragging === 'easy') {
      const clampedValue = Math.min(newValue, hardBoundary - step);
      onChange(Math.max(min, clampedValue), hardBoundary);
    } else {
      const clampedValue = Math.max(newValue, easyBoundary + step);
      onChange(easyBoundary, Math.min(max, clampedValue));
    }
  };

  const handleMouseUp = () => {
    setIsDragging(null);
  };

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, easyBoundary, hardBoundary]);

  const easyPercentage = getPercentage(easyBoundary);
  const hardPercentage = getPercentage(hardBoundary);

  return (
    <div className={`relative ${className}`}>
      <div
        ref={sliderRef}
        className="relative h-4 bg-gray-200 rounded cursor-pointer"
        onMouseDown={(e) => {
          const rect = sliderRef.current?.getBoundingClientRect();
          if (!rect) return;
          
          const percentage = ((e.clientX - rect.left) / rect.width) * 100;
          const newValue = getValueFromPercentage(percentage);
          
          // Determine which handle to move based on which is closer
          const easyDistance = Math.abs(newValue - easyBoundary);
          const hardDistance = Math.abs(newValue - hardBoundary);
          
          if (easyDistance < hardDistance) {
            const clampedValue = Math.min(newValue, hardBoundary - step);
            onChange(Math.max(min, clampedValue), hardBoundary);
          } else {
            const clampedValue = Math.max(newValue, easyBoundary + step);
            onChange(easyBoundary, Math.min(max, clampedValue));
          }
        }}
      >
        {/* Track */}
        <div className="absolute top-0 left-0 right-0 h-4 bg-gray-200 rounded"></div>
        
        {/* Easy segment (light green) */}
        <div
          className="absolute top-0 h-4 bg-green-300 rounded-l"
          style={{
            left: '0%',
            width: `${easyPercentage}%`
          }}
        ></div>
        
        {/* Medium segment (yellow) */}
        <div
          className="absolute top-0 h-4 bg-yellow-400"
          style={{
            left: `${easyPercentage}%`,
            width: `${hardPercentage - easyPercentage}%`
          }}
        ></div>
        
        {/* Hard segment (red) */}
        <div
          className="absolute top-0 h-4 bg-red-400 rounded-r"
          style={{
            left: `${hardPercentage}%`,
            width: `${100 - hardPercentage}%`
          }}
        ></div>
        
        {/* Easy handle */}
        <div
          className="absolute top-1/2 transform -translate-y-1/2 w-3 h-3 bg-green-600 rounded-full cursor-pointer shadow-sm hover:bg-green-700 transition-colors border border-white"
          style={{ left: `${easyPercentage}%`, marginLeft: '-6px' }}
          onMouseDown={(e) => handleMouseDown(e, 'easy')}
        ></div>
        
        {/* Hard handle */}
        <div
          className="absolute top-1/2 transform -translate-y-1/2 w-3 h-3 bg-red-600 rounded-full cursor-pointer shadow-sm hover:bg-red-700 transition-colors border border-white"
          style={{ left: `${hardPercentage}%`, marginLeft: '-6px' }}
          onMouseDown={(e) => handleMouseDown(e, 'hard')}
        ></div>
      </div>
      
      {/* Labels */}
      <div className="flex justify-between text-xs text-gray-500 mt-1">
        <span>Easy</span>
        <span>Medium</span>
        <span>Hard</span>
      </div>
    </div>
  );
};
