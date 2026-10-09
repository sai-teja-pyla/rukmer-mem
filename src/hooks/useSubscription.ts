import { useState, useEffect } from 'react';

export function useSubscription(user: any): { isPro: boolean; isLoading: boolean } {
  const [isPro, setIsPro] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsPro(!!user);
    setIsLoading(false);
  }, [user]);

  return { isPro, isLoading };
}
