import { createContext, useContext } from "react";

export const TextSizeContext = createContext({ percent: 100, setPercent: async () => {} });
export const useTextSize = () => useContext(TextSizeContext);
