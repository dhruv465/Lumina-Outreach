/**
 * Document Processor Utility
 * 
 * Handles text extraction from different document types
 * and splits text into chunks for vector embedding.
 */

import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { logger } from '../index';
import mammoth from 'mammoth';
import { parse } from 'csv-parse/sync';

const pdfParse = require('pdf-parse');
const readFileAsync = promisify(fs.readFile);

export class DocumentProcessor {
  /**
   * Extract text content from uploaded document
   */
  async extractText(filePath: string): Promise<string> {
    try {
      const fileExtension = path.extname(filePath).toLowerCase();
      
      switch (fileExtension) {
        case '.txt':
          return this.extractFromTextFile(filePath);
        case '.pdf':
          return this.extractFromPdfFile(filePath);
        case '.docx':
          return this.extractFromDocxFile(filePath);
        case '.md':
          return this.extractFromTextFile(filePath);
        case '.json':
          return this.extractFromJsonFile(filePath);
        case '.csv':
          return this.extractFromCsvFile(filePath);
        default:
          throw new Error(`Unsupported file type: ${fileExtension}`);
      }
    } catch (error) {
      logger.error(`Error extracting text from ${path.basename(filePath)}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
  
  /**
   * Extract text from plain text file
   */
  private async extractFromTextFile(filePath: string): Promise<string> {
    const buffer = await readFileAsync(filePath);
    return buffer.toString('utf-8');
  }
  
  /**
   * Extract text from PDF file
   */
  private async extractFromPdfFile(filePath: string): Promise<string> {
    const buffer = await readFileAsync(filePath);
    const data = await pdfParse(buffer);
    return data.text;
  }
  
  /**
   * Extract text from DOCX file
   */
  private async extractFromDocxFile(filePath: string): Promise<string> {
    const buffer = await readFileAsync(filePath);
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  
  /**
   * Extract text from JSON file
   */
  private async extractFromJsonFile(filePath: string): Promise<string> {
    const buffer = await readFileAsync(filePath);
    const jsonData = JSON.parse(buffer.toString('utf-8'));
    return JSON.stringify(jsonData, null, 2);
  }
  
  /**
   * Extract text from CSV file
   */
  private async extractFromCsvFile(filePath: string): Promise<string> {
    const buffer = await readFileAsync(filePath);
    const records = parse(buffer, {
      columns: true,
      skip_empty_lines: true
    });
    
    // Convert CSV rows to a readable string format for embedding
    return records.map((row: any) => 
      Object.entries(row)
        .map(([key, value]) => `${key}: ${value}`)
        .join(', ')
    ).join('\n');
  }
  
  /**
   * Split text content into chunks for vector embedding
   */
  splitTextIntoChunks(text: string, chunkSize: number = 1000, overlap: number = 200): string[] {
    try {
      const chunks: string[] = [];
      
      if (!text || text.trim() === '') {
        return [];
      }

      if (text.length <= chunkSize) {
        chunks.push(text);
        return chunks;
      }
      
      let startIndex = 0;
      
      while (startIndex < text.length) {
        let endIndex = startIndex + chunkSize;
        
        if (endIndex < text.length) {
          const paragraphBreak = text.indexOf('\n\n', endIndex - 100);
          const sentenceBreak = text.indexOf('. ', endIndex - 100);
          const spaceBreak = text.indexOf(' ', endIndex - 20);
          
          if (paragraphBreak !== -1 && paragraphBreak < endIndex + 100) {
            endIndex = paragraphBreak + 2;
          } else if (sentenceBreak !== -1 && sentenceBreak < endIndex + 50) {
            endIndex = sentenceBreak + 2;
          } else if (spaceBreak !== -1 && spaceBreak < endIndex + 20) {
            endIndex = spaceBreak + 1;
          }
        } else {
          endIndex = text.length;
        }
        
        const chunk = text.substring(startIndex, endIndex).trim();
        if (chunk) {
          chunks.push(chunk);
        }
        
        startIndex = endIndex - overlap;
        
        if (startIndex >= text.length) {
          break;
        }
      }
      
      return chunks;
    } catch (error) {
      logger.error(`Error splitting text: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
}
