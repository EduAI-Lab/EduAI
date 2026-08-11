import { createContext, useContext } from "react";
import type { ReactNode } from "react";

const CurrentUserIdContext = createContext<string | null>(null);

export function CurrentUserIdProvider({
  userId,
  children,
}: {
  userId: string;
  children: ReactNode;
}) {
  return (
    <CurrentUserIdContext.Provider value={userId}>
      {children}
    </CurrentUserIdContext.Provider>
  );
}

export function useCurrentUserId(): string | null {
  return useContext(CurrentUserIdContext);
}
