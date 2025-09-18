import { FastifyRequest, FastifyReply } from 'fastify';
import fs from 'fs';
import path from 'path';

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// This is a placeholder for file upload handling in Fastify.
// Fastify's multipart plugin handles file parsing directly in the route handler.
// This file is kept for compatibility with existing imports but its functionality
// is now integrated into the route controllers (e.g., leadController.ts for CSV import).

// You can define a preHandler hook if you need to process files before the main handler
// For example, to validate file types or sizes globally.
export const handleFileUpload = async (req: FastifyRequest, reply: FastifyReply) => {
  // Check if the request is multipart
  if (!req.isMultipart()) {
    return reply.status(400).send({ message: 'Request is not multipart' });
  }

  // Parse the multipart form data
  const data = await req.file();
  if (!data) {
    return reply.status(400).send({ message: 'No file uploaded' });
  }

  // Attach the file data to the request object for later use in controllers
  (req as any).file = data;
};