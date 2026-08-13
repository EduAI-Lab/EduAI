import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { hasSeenMainTour } from './mainTourStorage';

export function useAutoRedirectForMainTour() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!hasSeenMainTour()) {
      navigate('/courses', { replace: true });
    }
  }, [navigate]);
}
