import { FastifyInstance } from 'fastify';
import { createUser, loginUser, getUserProfile, updateUserProfile, getAllUsers } from '../controllers/userController';

const userRoutes = async (fastify, opts: Record<string, any>) => {
  fastify.post('/register', createUser);
  fastify.post('/login', loginUser);

  fastify.get('/profile', { onRequest: [fastify.authenticate] }, getUserProfile);
  fastify.put('/profile', { onRequest: [fastify.authenticate] }, updateUserProfile);
  fastify.get('/', { onRequest: [fastify.authenticate] }, getAllUsers);
};

export default userRoutes;