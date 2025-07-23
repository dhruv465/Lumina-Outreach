import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User';
import { logger } from '../index';
import { handleError } from '../utils/errorHandling';

// @desc    Register a new user
// @route   POST /api/users/register
// @access  Public
export const createUser = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { name, email, password, role } = req.body;

    // Check if user already exists
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
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

    return res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      token,
    });
  } catch (error) {
    logger.error('Error creating user:', error);
    return res.status(500).json({ message: 'Server error', error: handleError(error) });
  }
};

// @desc    Login user
// @route   POST /api/users/login
// @access  Public
export const loginUser = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { email, password } = req.body;

    // Check if user exists
    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Check if password matches
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: user._id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'default_secret',
      { expiresIn: '30d' }
    );

    return res.status(200).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      token,
    });
  } catch (error) {
    logger.error('Error logging in user:', error);
    return res.status(500).json({ message: 'Server error', error: handleError(error) });
  }
};

// @desc    Get user profile
// @route   GET /api/users/profile
// @access  Private
export const getUserProfile = async (req: Request & { user?: any }, res: Response): Promise<Response> => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.status(200).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
    });
  } catch (error) {
    logger.error('Error getting user profile:', error);
    return res.status(500).json({ message: 'Server error', error: handleError(error) });
  }
};

// @desc    Update user profile
// @route   PUT /api/users/profile
// @access  Private
export const updateUserProfile = async (req: Request & { user?: any }, res: Response): Promise<Response> => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const { name, email, password } = req.body;

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

    return res.status(200).json({
      _id: updatedUser._id,
      name: updatedUser.name,
      email: updatedUser.email,
      role: updatedUser.role,
      token: token || undefined,
    });
  } catch (error) {
    logger.error('Error updating user profile:', error);
    return res.status(500).json({ message: 'Server error', error: handleError(error) });
  }
};

// @desc    Get all users
// @route   GET /api/users
// @access  Private/Admin
export const getAllUsers = async (req: Request & { user?: any }, res: Response): Promise<Response> => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to access this resource' });
    }

    const users = await User.find({}).select('-password');
    return res.status(200).json(users);
  } catch (error) {
    logger.error('Error getting all users:', error);
    return res.status(500).json({ message: 'Server error', error: handleError(error) });
  }
};