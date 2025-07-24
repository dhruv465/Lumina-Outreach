import express from 'express';
import { authenticate } from '../middleware/auth';
import { createUser, loginUser, getUserProfile, updateUserProfile, getAllUsers } from '../controllers/userController';

const router = express.Router();

// Public routes
router.post('/register', createUser);
router.post('/login', loginUser);

// Protected routes
router.get('/profile', authenticate, getUserProfile);
router.put('/profile', authenticate, updateUserProfile);
router.get('/', authenticate, getAllUsers);

export default router;
