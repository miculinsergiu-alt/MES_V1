import { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import toast from 'react-hot-toast';
import { useAuth } from './AuthContext';

const SocketContext = createContext();

export const useSocket = () => useContext(SocketContext);

export const SocketProvider = ({ children }) => {
  const { user } = useAuth();
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    // Real-time updates need a login: the server only sends events of the user's own company.
    const token = localStorage.getItem('sf_token');
    if (!user || !token) {
      setSocket(null);
      return undefined;
    }

    const newSocket = io({ auth: { token } });

    newSocket.on('order:completed', (data) => {
      toast.success(`Order #${data.order_id} completed`, { duration: 5000 });
    });

    newSocket.on('production:action', (data) => {
      if (data.action_type === 'delay_start') {
        toast.error('A new delay was reported on the shop floor', { icon: '⚠️' });
      }
    });

    setSocket(newSocket);
    return () => newSocket.close();
  }, [user]);

  return (
    <SocketContext.Provider value={socket}>
      {children}
    </SocketContext.Provider>
  );
};
