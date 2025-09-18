import { FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../index';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import child_process from 'child_process';
import util from 'util';
import { getDeepgramService } from '../services/deepgramService';
import { getSDKService, ElevenLabsSDKService } from '../services/elevenlabsSDKService';

const exec = util.promisify(child_process.exec);

/**
 * Voice quality metrics
 */
export interface VoiceQualityMetrics {
  // Audio signal metrics
  signalToNoiseRatio?: number;
  mfcc?: number[];
  harmonicToNoiseRatio?: number;
  jitter?: number;
  shimmer?: number;

  // Perception metrics
  clarity?: number;
  naturalness?: number;
  pronunciation?: number;

  // STT metrics
  wordErrorRate: number;
  characterErrorRate: number;
  recognitionLatency: number;

  // TTS metrics
  synthesisLatency?: number;
  prosody?: number;

  // Overall scores
  overallQuality: number;
  passedThreshold: boolean;
}

/**
 * Test case for voice quality evaluation
 */
export interface VoiceQualityTestCase {
  id: string;
  name: string;
  description: string;
  inputText: string;
  expectedTranscription?: string;
  audioFilePath?: string;
  metrics?: VoiceQualityMetrics;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Voice quality test controller
 * Implements automated testing for voice quality and transcription accuracy
 */
export class VoiceQualityController {
  private testCases: VoiceQualityTestCase[] = [];
  private readonly outputDir: string;
  private readonly qualityThreshold: number = 70; // 0-100 scale

  constructor() {
    this.outputDir = path.join(process.cwd(), 'test-outputs', 'voice-quality');

    // Create output directory if it doesn't exist
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    // Load test cases from disk
    this.loadTestCases();
  }

  /**
   * Load test cases from disk
   */
  private loadTestCases(): void {
    try {
      const testCasesFile = path.join(this.outputDir, 'test-cases.json');

      if (fs.existsSync(testCasesFile)) {
        const data = fs.readFileSync(testCasesFile, 'utf8');
        this.testCases = JSON.parse(data);

        // Convert string dates to Date objects
        this.testCases = this.testCases.map(testCase => ({
          ...testCase,
          createdAt: new Date(testCase.createdAt),
          updatedAt: new Date(testCase.updatedAt)
        }));

        logger.info(`Loaded ${this.testCases.length} voice quality test cases`);
      } else {
        this.testCases = [];
        logger.info('No voice quality test cases found, starting with empty set');
      }
    } catch (error) {
      logger.error(`Error loading voice quality test cases: ${error}`);
      this.testCases = [];
    }
  }

  /**
   * Save test cases to disk
   */
  private saveTestCases(): void {
    try {
      const testCasesFile = path.join(this.outputDir, 'test-cases.json');
      fs.writeFileSync(testCasesFile, JSON.stringify(this.testCases, null, 2));
    } catch (error) {
      logger.error(`Error saving voice quality test cases: ${error}`);
    }
  }

  /**
   * Get all test cases
   */
  public getTestCases(req: FastifyRequest, res: FastifyReply): void {
    res.send({
      success: true,
      testCases: this.testCases.map(testCase => ({
        ...testCase,
        // Don't include full audio path in response
        audioFilePath: testCase.audioFilePath ? path.basename(testCase.audioFilePath) : undefined
      }))
    });
  }

  /**
   * Create a new test case
   */
  public createTestCase(req: FastifyRequest, res: FastifyReply): void {
    try {
      const { name, description, inputText, expectedTranscription } = req.body as any;

      if (!name || !inputText) {
        res.status(400).send({
          success: false,
          error: 'Name and inputText are required'
        });
        return;
      }

      const testCase: VoiceQualityTestCase = {
        id: uuidv4(),
        name,
        description: description || '',
        inputText,
        expectedTranscription,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      this.testCases.push(testCase);
      this.saveTestCases();

      res.send({
        success: true,
        testCase
      });
    } catch (error) {
      logger.error(`Error creating voice quality test case: ${error}`);
      res.status(500).send({
        success: false,
        error: 'Failed to create test case'
      });
    }
  }

  /**
   * Run a specific test case
   */
  public async runTestCase(req: FastifyRequest, res: FastifyReply): Promise<void> {
    try {
      const { id } = req.params as any;

      const testCase = this.testCases.find(tc => tc.id === id);
      if (!testCase) {
        res.status(404).send({
          success: false,
          error: 'Test case not found'
        });
        return;
      }

      // Start by generating TTS audio
      const audioFilePath = await this.generateTTSAudio(testCase);
      testCase.audioFilePath = audioFilePath;

      // Run speech-to-text on the generated audio
      const startTime = Date.now();
      const transcription = await this.performSTT(audioFilePath);
      const recognitionLatency = Date.now() - startTime;

      // Analyze audio quality
      const audioQualityMetrics = await this.analyzeAudioQuality(audioFilePath);

      // Calculate word error rate if expected transcription is provided
      let wordErrorRate = 0;
      let characterErrorRate = 0;

      if (testCase.expectedTranscription) {
        wordErrorRate = this.calculateWordErrorRate(
          testCase.expectedTranscription,
          transcription
        );

        characterErrorRate = this.calculateCharacterErrorRate(
          testCase.expectedTranscription,
          transcription
        );
      } else {
        // If no expected transcription, compare with input text
        wordErrorRate = this.calculateWordErrorRate(
          testCase.inputText,
          transcription
        );

        characterErrorRate = this.calculateCharacterErrorRate(
          testCase.inputText,
          transcription
        );
      }

      // Calculate overall quality score
      const overallQuality = this.calculateOverallQualityScore(
        audioQualityMetrics,
        wordErrorRate,
        characterErrorRate,
        recognitionLatency
      );

      // Save metrics
      testCase.metrics = {
        ...audioQualityMetrics,
        wordErrorRate,
        characterErrorRate,
        recognitionLatency,
        overallQuality,
        passedThreshold: overallQuality >= this.qualityThreshold
      };

      testCase.updatedAt = new Date();
      this.saveTestCases();

      res.send({
        success: true,
        testCase: {
          ...testCase,
          audioFilePath: path.basename(testCase.audioFilePath)
        },
        transcription
      });
    } catch (error) {
      logger.error(`Error running voice quality test case: ${error}`);
      res.status(500).send({
        success: false,
        error: 'Failed to run test case'
      });
    }
  }

  /**
   * Run all test cases
   */
  public async runAllTestCases(req: FastifyRequest, res: FastifyReply): Promise<void> {
    try {
      const results = [];

      for (const testCase of this.testCases) {
        try {
          // Generate TTS audio
          const audioFilePath = await this.generateTTSAudio(testCase);
          testCase.audioFilePath = audioFilePath;

          // Run speech-to-text on the generated audio
          const startTime = Date.now();
          const transcription = await this.performSTT(audioFilePath);
          const recognitionLatency = Date.now() - startTime;

          // Analyze audio quality
          const audioQualityMetrics = await this.analyzeAudioQuality(audioFilePath);

          // Calculate word error rate
          let wordErrorRate = 0;
          let characterErrorRate = 0;

          if (testCase.expectedTranscription) {
            wordErrorRate = this.calculateWordErrorRate(
              testCase.expectedTranscription,
              transcription
            );

            characterErrorRate = this.calculateCharacterErrorRate(
              testCase.expectedTranscription,
              transcription
            );
          } else {
            // If no expected transcription, compare with input text
            wordErrorRate = this.calculateWordErrorRate(
              testCase.inputText,
              transcription
            );

            characterErrorRate = this.calculateCharacterErrorRate(
              testCase.inputText,
              transcription
            );
          }

          // Calculate overall quality score
          const overallQuality = this.calculateOverallQualityScore(
            audioQualityMetrics,
            wordErrorRate,
            characterErrorRate,
            recognitionLatency
          );

          // Save metrics
          testCase.metrics = {
            ...audioQualityMetrics,
            wordErrorRate,
            characterErrorRate,
            recognitionLatency,
            overallQuality,
            passedThreshold: overallQuality >= this.qualityThreshold
          };

          testCase.updatedAt = new Date();

          results.push({
            id: testCase.id,
            name: testCase.name,
            passed: testCase.metrics.passedThreshold,
            overallQuality: testCase.metrics.overallQuality,
            wordErrorRate: testCase.metrics.wordErrorRate,
            transcription
          });
        } catch (error) {
          logger.error(`Error running test case ${testCase.id}: ${error}`);
          results.push({
            id: testCase.id,
            name: testCase.name,
            error: `Failed to run test: ${error}`
          });
        }
      }

      this.saveTestCases();

      res.send({
        success: true,
        results,
        summary: {
          total: this.testCases.length,
          passed: results.filter((r: any) => r.passed).length,
          failed: results.filter((r: any) => r.passed === false).length,
          error: results.filter((r: any) => r.error).length,
          averageQuality: this.calculateAverageQuality()
        }
      });
    } catch (error) {
      logger.error(`Error running all voice quality test cases: ${error}`);
      res.status(500).send({
        success: false,
        error: 'Failed to run test cases'
      });
    }
  }

  /**
   * Get test case results
   */
  public getTestCaseResults(req: FastifyRequest, res: FastifyReply): void {
    try {
      const { id } = req.params as any;

      const testCase = this.testCases.find(tc => tc.id === id);
      if (!testCase) {
        res.status(404).send({
          success: false,
          error: 'Test case not found'
        });
        return;
      }

      if (!testCase.metrics) {
        res.status(400).send({
          success: false,
          error: 'Test case has not been run yet'
        });
        return;
      }

      res.send({
        success: true,
        testCase: {
          ...testCase,
          audioFilePath: testCase.audioFilePath ? path.basename(testCase.audioFilePath) : undefined
        }
      });
    } catch (error) {
      logger.error(`Error getting voice quality test case results: ${error}`);
      res.status(500).send({
        success: false,
        error: 'Failed to get test case results'
      });
    }
  }

  /**
   * Generate TTS audio for a test case
   */
  private async generateTTSAudio(testCase: VoiceQualityTestCase): Promise<string> {
    try {
      const elevenlabsService = getSDKService();
      if (!elevenlabsService) {
        throw new Error('ElevenLabs service not initialized');
      }

      const outputFilePath = path.join(this.outputDir, `${testCase.id}.mp3`);

      // Generate audio using ElevenLabs
      const audioBuffer = await elevenlabsService.generateSpeech(
        testCase.inputText,
        'pNInz6obpgDQGcFmaJgB', // Default voice ID
        { optimizeLatency: true }
      );

      // Save to file
      fs.writeFileSync(outputFilePath, audioBuffer);

      return outputFilePath;
    } catch (error) {
      logger.error(`Error generating TTS audio: ${error}`);
      throw error;
    }
  }

  /**
   * Perform STT on an audio file
   */
  private async performSTT(audioFilePath: string): Promise<string> {
    try {
      const deepgramService = getDeepgramService();
      if (!deepgramService) {
        throw new Error('Deepgram service not initialized');
      }

      // Read audio file
      const audioBuffer = fs.readFileSync(audioFilePath);

      // Transcribe using Deepgram
      const result = await deepgramService.transcribeAudio(audioBuffer, {
        model: 'nova-2',
        language: 'en-US'
      });

      return result.transcript;
    } catch (error) {
      logger.error(`Error performing STT: ${error}`);
      throw error;
    }
  }

  /**
   * Analyze audio quality using FFmpeg
   * This is a simplified version - in production, use a more sophisticated audio analysis library
   */
  private async analyzeAudioQuality(audioFilePath: string): Promise<Partial<VoiceQualityMetrics>> {
    try {
      // Use FFmpeg to analyze audio properties
      const { stdout } = await exec(`ffprobe -v error -show_format -show_streams -of json "${audioFilePath}"`);
      const audioInfo = JSON.parse(stdout);

      // Extract basic audio properties
      const audioStream = audioInfo.streams.find((s: any) => s.codec_type === 'audio');

      if (!audioStream) {
        throw new Error('No audio stream found in file');
      }

      // Simulate quality metrics based on audio properties
      // These are placeholder calculations - replace with actual measurements
      const bitrate = parseInt(audioStream.bit_rate || audioInfo.format.bit_rate || '128000', 10);
      const sampleRate = parseInt(audioStream.sample_rate || '44100', 10);
      const channels = audioStream.channels || 1;

      // Calculate simulated metrics
      // These are placeholder calculations - replace with actual measurements
      const signalToNoiseRatio = Math.min(95, (bitrate / 16000) * 20);
      const clarity = Math.min(95, (bitrate / 32000) * 25);
      const naturalness = Math.min(90, (sampleRate / 44100) * 90);
      const pronunciation = 85; // Placeholder

      // Generate placeholder MFCCs
      const mfcc = Array.from({ length: 13 }, () => Math.random() * 10 - 5);

      return {
        signalToNoiseRatio,
        mfcc,
        harmonicToNoiseRatio: 20, // Placeholder
        jitter: 0.02, // Placeholder
        shimmer: 0.1, // Placeholder
        clarity,
        naturalness,
        pronunciation,
        synthesisLatency: 500, // Placeholder
        prosody: 80 // Placeholder
      };
    } catch (error) {
      logger.error(`Error analyzing audio quality: ${error}`);
      // Return default values if analysis fails
      return {
        signalToNoiseRatio: 60,
        mfcc: Array.from({ length: 13 }, () => 0),
        harmonicToNoiseRatio: 15,
        jitter: 0.05,
        shimmer: 0.2,
        clarity: 70,
        naturalness: 70,
        pronunciation: 70,
        synthesisLatency: 700,
        prosody: 70
      };
    }
  }

  /**
   * Calculate word error rate between expected and actual transcriptions
   */
  private calculateWordErrorRate(expected: string, actual: string): number {
    const expectedWords = expected.trim().toLowerCase().split(/\s+/);
    const actualWords = actual.trim().toLowerCase().split(/\s+/);

    const distance = this.levenshteinDistance(expectedWords, actualWords);
    return distance / expectedWords.length;
  }

  /**
   * Calculate character error rate between expected and actual transcriptions
   */
  private calculateCharacterErrorRate(expected: string, actual: string): number {
    const expectedChars = expected.trim().toLowerCase().split('');
    const actualChars = actual.trim().toLowerCase().split('');

    const distance = this.levenshteinDistance(expectedChars, actualChars);
    return distance / expectedChars.length;
  }

  /**
   * Calculate Levenshtein distance between two arrays
   */
  private levenshteinDistance(a: any[], b: any[]): number {
    const matrix = Array(a.length + 1).fill(null).map(() => Array(b.length + 1).fill(null));

    for (let i = 0; i <= a.length; i++) {
      matrix[i][0] = i;
    }

    for (let j = 0; j <= b.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1, // deletion
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j - 1] + cost // substitution
        );
      }
    }

    return matrix[a.length][b.length];
  }

  /**
   * Calculate overall quality score
   */
  private calculateOverallQualityScore(
    audioQualityMetrics: Partial<VoiceQualityMetrics>,
    wordErrorRate: number,
    characterErrorRate: number,
    recognitionLatency: number
  ): number {
    // Normalize word error rate to a 0-100 scale (0 = perfect, 100 = completely wrong)
    const wordErrorScore = 100 * (1 - Math.min(1, wordErrorRate));

    // Normalize character error rate to a 0-100 scale
    const characterErrorScore = 100 * (1 - Math.min(1, characterErrorRate));

    // Normalize recognition latency (0-2000ms) to a 0-100 scale
    const latencyScore = 100 * (1 - Math.min(1, recognitionLatency / 2000));

    // Weights for different components
    const weights = {
      signalToNoiseRatio: 0.1,
      clarity: 0.15,
      naturalness: 0.15,
      pronunciation: 0.1,
      wordErrorScore: 0.2,
      characterErrorScore: 0.1,
      latencyScore: 0.1,
      prosody: 0.1
    };

    // Calculate weighted score
    const weightedScore =
      (audioQualityMetrics.signalToNoiseRatio || 0) * weights.signalToNoiseRatio +
      (audioQualityMetrics.clarity || 0) * weights.clarity +
      (audioQualityMetrics.naturalness || 0) * weights.naturalness +
      (audioQualityMetrics.pronunciation || 0) * weights.pronunciation +
      wordErrorScore * weights.wordErrorScore +
      characterErrorScore * weights.characterErrorScore +
      latencyScore * weights.latencyScore +
      (audioQualityMetrics.prosody || 0) * weights.prosody;

    return Math.round(weightedScore);
  }

  /**
   * Calculate average quality across all test cases
   */
  private calculateAverageQuality(): number {
    const testCasesWithMetrics = this.testCases.filter(tc => tc.metrics);

    if (testCasesWithMetrics.length === 0) {
      return 0;
    }

    const totalQuality = testCasesWithMetrics.reduce(
      (sum, tc) => sum + (tc.metrics?.overallQuality || 0),
      0
    );

    return Math.round(totalQuality / testCasesWithMetrics.length);
  }

  /**
   * Delete a test case
   */
  public deleteTestCase(req: FastifyRequest, res: FastifyReply): void {
    try {
      const { id } = req.params as any;

      const index = this.testCases.findIndex(tc => tc.id === id);
      if (index === -1) {
        res.status(404).send({
          success: false,
          error: 'Test case not found'
        });
        return;
      }

      // Delete audio file if it exists
      const testCase = this.testCases[index];
      if (testCase.audioFilePath && fs.existsSync(testCase.audioFilePath)) {
        fs.unlinkSync(testCase.audioFilePath);
      }

      // Remove from array
      this.testCases.splice(index, 1);
      this.saveTestCases();

      res.send({
        success: true,
        message: 'Test case deleted successfully'
      });
    } catch (error) {
      logger.error(`Error deleting voice quality test case: ${error}`);
      res.status(500).send({
        success: false,
        error: 'Failed to delete test case'
      });
    }
  }
}

// Export controller instance
export const voiceQualityController = new VoiceQualityController();
