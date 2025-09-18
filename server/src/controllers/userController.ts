import { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import User from '../models/User';
import { logger } from '../index';
import { handleError } from '../utils/errorHandling';

// @desc    Register a new user
// @route   POST /api/users/register
// @access  Public
export const createUser = async (req: FastifyRequest, res: FastifyReply): Promise<any> => {
  try {
    const { name, email, password, role } = req.body as any;

    // Check if user already exists
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).send({ message: 'User already exists' });
    }

    // Create user
    const user = await User.create({
      name,
      email,
      password,
      role: role || 'agent',
    });

    // Generate JWT token
    const token = jwt.sign(
      { id: user._id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'default_secret',
      { expiresIn: '30d' }
    );

    return res.status(201).send({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      token,
    });
  } catch (error) {
    logger.error('Error creating user:', error);
    return res.status(500).send({ message: 'Server error', error: handleError(error) });
  }
};

// @desc    Login user
// @route   POST /api/users/login
// @access  Public
export const loginUser = async (req: FastifyRequest, res: FastifyReply): Promise<any> => {
  try {
    const { email, password } = req.body as any;

    // Check if user exists
    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(401).send({ message: 'Invalid credentials' });
    }

    // Check if password matches
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).send({ message: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: user._id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'default_secret',
      { expiresIn: '30d' }
    );

    return res.status(200).send({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      token,
    });
  } catch (error) {
    logger.error('Error logging in user:', error);
    return res.status(500).send({ message: 'Server error', error: handleError(error) });
  }
};

// @desc    Get user profile
// @route   GET /api/users/profile
// @access  Private
export const getUserProfile = async (req: FastifyRequest & { user?: any }, res: FastifyReply): Promise<any> => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).send({ message: 'User not found' });
    }

    return res.status(200).send({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
    });
  } catch (error) {
    logger.error('Error getting user profile:', error);
    return res.status(500).send({ message: 'Server error', error: handleError(error) });
  }
};

// @desc    Update user profile
// @route   PUT /api/users/profile
// @access  Private
export const updateUserProfile = async (req: FastifyRequest & { user?: any }, res: FastifyReply): Promise<any> => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).send({ message: 'User not found' });
    }

    const { name, email, password } = req.body as any;

    // Update fields
    if (name) user.name = name;
    if (email) user.email = email;
    if (password) user.password = password;

    // Save updated user
    const updatedUser = await user.save();

    // Generate new JWT token if email changed
    let token;
    if (email) {
      token = jwt.sign(
        { id: updatedUser._id, email: updatedUser.email, role: updatedUser.role },
        process.env.JWT_SECRET || 'default_secret',
        { expiresIn: '30d' }
      );
    }

    return res.status(200).send({
      _id: updatedUser._id,
      name: updatedUser.name,
      email: updatedUser.email,
      role: updatedUser.role,
      token: token || undefined,
    });
  } catch (error) {
    logger.error('Error updating user profile:', error);
    return res.status(500).send({ message: 'Server error', error: handleError(error) });
  }
};

// @desc    Get all users
// @route   GET /api/users
// @access  Private/Admin
export const getAllUsers = async (req: FastifyRequest & { user?: any }, res: FastifyReply): Promise<any> => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).send({ message: 'Not authorized to access this resource' });
    }

    const users = await User.find({}).select('-password');
    return res.status(200).send(users);
  } catch (error) {
    logger.error('Error getting all users:', error);
    return res.status(500).send({ message: 'Server error', error: handleError(error) });
  }
};