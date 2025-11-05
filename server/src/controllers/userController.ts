import { FastifyRequest, FastifyReply } from 'fastify';
import { userService } from '../services/userService';
import { handleError } from '../utils/errorHandling';

// @desc    Register a new user
// @route   POST /api/users/register
// @access  Public
export const createUser = async (req: FastifyRequest, res: FastifyReply): Promise<any> => {
  try {
    const { user, token } = await userService.createUser(req.body);
    return res.status(201).send({ _id: user._id, name: user.name, email: user.email, role: user.role, token });
  } catch (error) {
    return res.status(500).send({ message: 'Server error', error: handleError(error) });
  }
};

// @desc    Login user
// @route   POST /api/users/login
// @access  Public
export const loginUser = async (req: FastifyRequest, res: FastifyReply): Promise<any> => {
  try {
    const { user, token } = await userService.loginUser(req.body);
    return res.status(200).send({ _id: user._id, name: user.name, email: user.email, role: user.role, token });
  } catch (error) {
    return res.status(500).send({ message: 'Server error', error: handleError(error) });
  }
};

// @desc    Get user profile
// @route   GET /api/users/profile
// @access  Private
export const getUserProfile = async (req: FastifyRequest & { user?: any }, res: FastifyReply): Promise<any> => {
  try {
    const user = await userService.getUserProfile(req.user.id);
    if (!user) {
      return res.status(404).send({ message: 'User not found' });
    }
    return res.status(200).send({ _id: user._id, name: user.name, email: user.email, role: user.role });
  } catch (error) {
    return res.status(500).send({ message: 'Server error', error: handleError(error) });
  }
};

// @desc    Update user profile
// @route   PUT /api/users/profile
// @access  Private
export const updateUserProfile = async (req: FastifyRequest & { user?: any }, res: FastifyReply): Promise<any> => {
  try {
    const { user, token } = await userService.updateUserProfile(req.user.id, req.body);
    return res.status(200).send({ _id: user._id, name: user.name, email: user.email, role: user.role, token });
  } catch (error) {
    return res.status(500).send({ message: 'Server error', error: handleError(error) });
  }
};

// @desc    Get all users
// @route   GET /api/users
// @access  Private/Admin
export const getAllUsers = async (req: FastifyRequest & { user?: any }, res: FastifyReply): Promise<any> => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).send({ message: 'Not authorized to access this resource' });
    }
    const users = await userService.getAllUsers();
    return res.status(200).send(users);
  } catch (error) {
    return res.status(500).send({ message: 'Server error', error: handleError(error) });
  }
};