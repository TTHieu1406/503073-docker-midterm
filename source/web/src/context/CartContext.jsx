import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { addLine, countItems, setQuantity, totalCents } from '../lib/cart.js';

const STORAGE_KEY = 'dockmart.cart';
const CartContext = createContext(null);

function restoreCart() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? [];
  } catch {
    return [];
  }
}

export function CartProvider({ children }) {
  const [lines, setLines] = useState(restoreCart);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
  }, [lines]);

  const value = useMemo(
    () => ({
      lines,
      count: countItems(lines),
      total: totalCents(lines),
      add: (product) => setLines((current) => addLine(current, product)),
      update: (id, quantity) => setLines((current) => setQuantity(current, id, quantity)),
      clear: () => setLines([]),
    }),
    [lines],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export const useCart = () => useContext(CartContext);
