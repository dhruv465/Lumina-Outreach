import { Request } from 'express';
import { User } from '../models/User'; // Adjust the import path as needed

declare global {
  namespace Express {
    export interface Request {
      user?: User;
    }
  }
}