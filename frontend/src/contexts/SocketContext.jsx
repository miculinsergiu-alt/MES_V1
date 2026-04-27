import { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import toast from 'react-hot-toast';

const SocketContext = createContext();

export const useSocket = () => useContext(SocketContext);

export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    const newSocket = io({
      withCredentials: true,
    });

    newSocket.on('connect', () => {
      console.log('[Socket] Connected to server');
    });

    // Global notifications for high-priority events
    newSocket.on('order:completed', (data) => {
      toast.success(`Comanda #${data.order_id} a fost finalizată!`, { duration: 5000 });
    });

    newSocket.on('production:action', (data) => {
      if (data.action_type === 'delay_start') {
        toast.error('Un nou delay a fost raportat pe flux!', { icon: '⚠️' });
      }
    });

    setSocket(newSocket);

    return () => newSocket.close();
  }, []);

  return (
    <SocketContext.Provider value={socket}>
      {children}
    </SocketContext.Provider>
  );
};
