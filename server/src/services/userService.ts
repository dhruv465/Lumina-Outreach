import User from '../models/User';
import jwt from 'jsonwebtoken';

class UserService {
  async createUser(data: any) {
    const { name, email, password, role } = data;

    const userExists = await User.findOne({ email });
    if (userExists) {
      throw new Error('User already exists');
    }

    const user = await User.create({
      name,
      email,
      password,
      role: role || 'agent',
    });

    const token = jwt.sign(
      { id: user._id, email: user.email, role: user.role, jwtVersion: user.jwtVersion },
      process.env.JWT_SECRET || 'default_secret',
      { expiresIn: '30d' }
    );

    return { user, token };
  }

  async loginUser(data: any) {
    const { email, password } = data;

    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      throw new Error('Invalid credentials');
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      throw new Error('Invalid credentials');
    }

    const token = jwt.sign(
      { id: user._id, email: user.email, role: user.role, jwtVersion: user.jwtVersion },
      process.env.JWT_SECRET || 'default_secret',
      { expiresIn: '30d' }
    );

    return { user, token };
  }

  async getUserProfile(id: string) {
    return User.findById(id);
  }

  async updateUserProfile(id: string, data: any) {
    const user = await User.findById(id);
    if (!user) {
      throw new Error('User not found');
    }

    const { name, email, password } = data;

    if (name) user.name = name;
    if (email) user.email = email;
    if (password) user.password = password;

    if (email || password) {
      await user.incrementJwtVersion();
    }

    const updatedUser = await user.save();

    const token = jwt.sign(
      { id: updatedUser._id, email: updatedUser.email, role: updatedUser.role, jwtVersion: updatedUser.jwtVersion },
      process.env.JWT_SECRET || 'default_secret',
      { expiresIn: '30d' }
    );

    return { user: updatedUser, token };
  }

  async getAllUsers() {
    return User.find({}).select('-password');
  }
}

export const userService = new UserService();
