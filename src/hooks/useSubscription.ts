import { useState, useEffect } from 'react';
import { isProPlan } from '../services/plan';

export function useSubscription(user: any): { isPro: boolean; isLoading: boolean } {
  const [isPro, setIsPro] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsPro(isProPlan(user));
    setIsLoading(false);
  }, [user]);

  return { isPro, isLoading };
}
