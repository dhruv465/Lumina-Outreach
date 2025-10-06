/**
 * Deepgram Service Methods
 * Contains helper functions for the Deepgram Service
 */
import { DeepgramClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';
import { getErrorMessage } from '../utils/errorUtils';
import { validateAndFetch } from './deepgramUtils';

// Mock deepgramModelMetrics if not available
const deepgramModelMetrics = {
	recordTranscriptionLatency: (model: string, latency: number) => {},
	recordTranscriptionConfidence: (model: string, confidence: number) => {},
	incrementTranscriptionCount: (model: string) => {}
};

// Define the interfaces needed for DeepgramService
export interface DeepgramStreamOptions {
	language?: string;
	model?: string;
	tier?: string;
	detectLanguage?: boolean;
	punctuate?: boolean;
	profanity_filter?: boolean;
	redact?: boolean;
	diarize?: boolean;
	multichannel?: boolean;
	alternatives?: number;
	numerals?: boolean;
	smart_format?: boolean;
	endpointing?: number;
	utteranceEndMs?: number;
	keywords?: string[];
	interim_results?: boolean;
	callback?: string;
}

export interface TranscriptResult {
	id: string;
	callId: string;
	text: string;
	isFinal: boolean;
	confidence: number;
	words: Array<{
		word: string;
		start: number;
		end: number;
		confidence: number;
	}>;
	metadata: {
		startTime: number;
		endTime: number;
		processingLatency: number;
	};
}

/**
 * Create a real-time transcription stream for raw audio data
 * @param client Deepgram client instance
 * @param callId Unique identifier for the call
 * @param options Configuration options for the stream
 * @returns EventEmitter for transcription events
 */
export async function createRawTranscriptionStream(
	client: DeepgramClient,
	callId: string,
	options: DeepgramStreamOptions = {}
): Promise<EventEmitter> {
	const emitter = new EventEmitter();

	try {
		// Configure transcription options
		const streamOptions = {
			language: options.language || 'en-US',
			model: options.model || 'nova-2',
			punctuate: options.punctuate !== false,
			diarize: options.diarize || false,
			interim_results: options.interim_results !== false,
			encoding: 'linear16',
			sample_rate: 16000,
			channels: 1,
			endpointing: options.endpointing || 0,
			utterance_end_ms: options.utteranceEndMs || 0
		};

		// Create Deepgram connection
		logger.info(`Creating Deepgram connection for call ${callId} with options:`, JSON.stringify(streamOptions));

		const connection = client.listen.live(streamOptions);

		// Set up Deepgram event handlers
		connection.addListener(LiveTranscriptionEvents.Open, () => {
			logger.info(`Deepgram connection opened for call ${callId}`);
			emitter.emit('open');
		});

		connection.addListener(LiveTranscriptionEvents.Transcript, (data) => {
			try {
				// Process the transcript data
				const channel = data.channel?.alternatives[0];

				if (!channel) {
					logger.warn(`No transcript channel found for call ${callId}`);
					return;
				}

				const isFinal = !!data.is_final;
				const words = channel.words || [];
				const text = channel.transcript || '';
				const confidence = channel.confidence || 0;

				// Generate transcript result
				const result: TranscriptResult = {
					id: uuidv4(),
					callId,
					text,
					isFinal,
					confidence,
					words: words.map(w => ({
						word: w.word,
						start: w.start,
						end: w.end,
						confidence: w.confidence
					})),
					metadata: { startTime: Date.now(), endTime: Date.now(), processingLatency: data.speech_final ? data.speech_final.processingLatency : 0 }
				};

				// Update metrics
				if (isFinal && options.model) {
					deepgramModelMetrics.recordTranscriptionLatency(options.model, result.metadata.processingLatency);
					deepgramModelMetrics.recordTranscriptionConfidence(options.model, confidence);
					deepgramModelMetrics.incrementTranscriptionCount(options.model);
				}

				// Emit the transcript event
				emitter.emit('transcript', result);
			} catch (error) {
				logger.error(`Error processing transcription result: ${getErrorMessage(error)}`);
			}
		});

		connection.addListener(LiveTranscriptionEvents.Metadata, (data) => {
			logger.debug(`Received metadata from Deepgram for call ${callId}`);
			emitter.emit('metadata', data);
		});

		connection.addListener(LiveTranscriptionEvents.Error, (error) => {
			logger.error(`Deepgram error for call ${callId}: ${getErrorMessage(error)}`);
			emitter.emit('error', { error: getErrorMessage(error) });
		});

		connection.addListener(LiveTranscriptionEvents.Close, () => {
			logger.info(`Deepgram connection closed for call ${callId}`);
			emitter.emit('close');
		});

		// Add methods to send audio data
			emitter.on('sendAudio', (audioChunk: Buffer) => {
				try {
					// Convert Node Buffer to ArrayBuffer slice to satisfy WebSocket typings
					const arrayBuffer = audioChunk.buffer.slice(audioChunk.byteOffset, audioChunk.byteOffset + audioChunk.byteLength);
					connection.send(arrayBuffer as any);
				} catch (sendError) {
					logger.error(`Error sending audio data: ${getErrorMessage(sendError)}`);
				}
			});

		// Add method to close the connection
		emitter.on('close', () => {
			try {
				connection.finish();
			} catch (closeError) {
				logger.error(`Error closing deepgram stream: ${getErrorMessage(closeError)}`);
			}
		});

		// Automatically close the connection if the emitter is destroyed
		emitter.on('removeAllListeners', () => {
			try {
				connection.finish();
			} catch (closeError) {
				logger.error(`Error closing deepgram stream: ${getErrorMessage(closeError)}`);
			}
		});

		return emitter;
	} catch (error) {
		logger.error(`Error creating Deepgram stream: ${getErrorMessage(error)}`);
		emitter.emit('error', { error: 'Failed to create Deepgram connection' });
		return emitter;
	}
}

/**
 * Transcribe an audio buffer using Deepgram
 * @param client Deepgram client instance
 * @param audioBuffer Buffer containing audio data
 * @param options Transcription options
 * @returns Transcription result
 */
export async function transcribeBuffer(
	client: DeepgramClient,
	audioBuffer: Buffer,
	options: DeepgramStreamOptions = {}
): Promise<{ transcript: string; confidence: number }> {
	try {
		const startTime = Date.now();

		// Configure transcription options
		const transcribeOptions = {
			language: options.language || 'en-US',
			model: options.model || 'nova-2',
			punctuate: options.punctuate !== false,
			diarize: options.diarize || false
		};

		logger.info(`Transcribing audio buffer with options: ${JSON.stringify(transcribeOptions)}`);

		// Use Deepgram to transcribe the buffer
		const response = await client.listen.prerecorded.transcribeFile(audioBuffer, {
			language: transcribeOptions.language,
			model: transcribeOptions.model,
			punctuate: transcribeOptions.punctuate,
			diarize: transcribeOptions.diarize
		});

		// Calculate processing time
		const processingTime = Date.now() - startTime;

		// Extract the transcript from the response
		let transcript = '';
		let confidence = 0;

			const channels = response.result?.results?.channels;
			const alt = channels && channels.length > 0 && channels[0].alternatives && channels[0].alternatives.length > 0
				? channels[0].alternatives[0]
				: null;

			if (alt) {
				transcript = alt.transcript || '';
				confidence = alt.confidence || 0;
			}

		// Update metrics
		deepgramModelMetrics.recordTranscriptionLatency(transcribeOptions.model, processingTime);
		deepgramModelMetrics.recordTranscriptionConfidence(transcribeOptions.model, confidence);
		deepgramModelMetrics.incrementTranscriptionCount(transcribeOptions.model);

		logger.info(`Transcription completed in ${processingTime}ms with confidence ${confidence}`);
		return { transcript, confidence };
	} catch (error) {
		logger.error(`Error transcribing audio buffer: ${getErrorMessage(error)}`);
		throw new Error(`Failed to transcribe audio: ${getErrorMessage(error)}`);
	}
}

/**
 * Transcribe audio from a URL using Deepgram
 * @param client Deepgram client instance
 * @param audioUrl URL to the audio file
 * @param options Transcription options
 * @returns Transcription result
 */
export async function transcribeUrl(
	client: DeepgramClient,
	audioUrl: string,
	options: DeepgramStreamOptions = {}
): Promise<{ transcript: string; confidence: number }> {
	try {
		const startTime = Date.now();

		// Configure transcription options
		const transcribeOptions = {
			language: options.language || 'en-US',
			model: options.model || 'nova-2',
			punctuate: options.punctuate !== false,
			diarize: options.diarize || false
		};

		logger.info(`Transcribing audio URL ${audioUrl} with options: ${JSON.stringify(transcribeOptions)}`);

			// Fetch and validate remote audio locally to avoid letting the SDK fetch the URL
			const audioBuffer = await validateAndFetch(audioUrl, { maxSizeBytes: 50 * 1024 * 1024 });
			if (!audioBuffer) {
				throw new Error(`Remote media unavailable: ${audioUrl}`);
			}

			// Use the existing transcribeBuffer implementation which calls transcribeFile
			const result = await transcribeBuffer(client, audioBuffer, transcribeOptions);

		const processingTime = Date.now() - startTime;
		deepgramModelMetrics.recordTranscriptionLatency(transcribeOptions.model as string, processingTime);
		deepgramModelMetrics.incrementTranscriptionCount(transcribeOptions.model as string);

		logger.info(`URL transcription completed in ${processingTime}ms with confidence ${result.confidence}`);
		return result;
	} catch (error) {
		logger.error(`Error transcribing audio URL: ${getErrorMessage(error)}`);
		throw new Error(`Failed to transcribe audio URL: ${getErrorMessage(error)}`);
	}
}