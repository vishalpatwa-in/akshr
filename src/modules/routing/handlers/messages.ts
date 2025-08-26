/**
 * Messages API Handlers
 * Implements CRUD operations for messages within threads
 */

import { z } from 'zod';
import type { Env } from '../../../index';
import { createR2Storage } from '../../r2-helpers';
import {
  CreateMessageRequest,
  UpdateMessageRequest,
  MessageResponse,
  ListMessagesResponse
} from '../../validators';
import type { Message } from '../../models';

// Generate unique ID
const generateId = () => crypto.randomUUID();

// Create message
export const createMessage = async (request: Request, env: Env, params: Record<string, string>) => {
  try {
    const threadId = params.thread_id;
    if (!threadId) {
      return new Response(JSON.stringify({
        error: { message: 'Thread ID is required' }
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const body = await request.json();
    const validatedData = CreateMessageRequest.parse(body);

    const storage = createR2Storage(env.R2_BUCKET);

    // Verify thread exists
    const thread = await storage.threads.get(threadId);
    if (!thread) {
      return new Response(JSON.stringify({
        error: { message: 'Thread not found' }
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const messageId = generateId();
    const message: Message = {
      id: messageId,
      object: 'message',
      created_at: Math.floor(Date.now() / 1000),
      thread_id: threadId,
      role: validatedData.role,
      content: validatedData.content,
      file_ids: validatedData.file_ids,
      metadata: validatedData.metadata,
      assistant_id: validatedData.assistant_id,
      run_id: validatedData.run_id,
      tool_call_id: validatedData.tool_call_id
    };

    await storage.messages.put(threadId, message);

    return new Response(JSON.stringify(message), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return new Response(JSON.stringify({
        error: { message: 'Validation failed', details: error.issues }
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.error('Create message error:', error);
    return new Response(JSON.stringify({
      error: { message: 'Internal server error' }
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

// Get message
export const getMessage = async (request: Request, env: Env, params: Record<string, string>) => {
  try {
    const threadId = params.thread_id;
    const messageId = params.message_id;

    if (!threadId || !messageId) {
      return new Response(JSON.stringify({
        error: { message: 'Thread ID and Message ID are required' }
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const storage = createR2Storage(env.R2_BUCKET);
    const message = await storage.messages.get(threadId, messageId);

    if (!message) {
      return new Response(JSON.stringify({
        error: { message: 'Message not found' }
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify(message), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Get message error:', error);
    return new Response(JSON.stringify({
      error: { message: 'Internal server error' }
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

// List messages (simplified implementation)
export const listMessages = async (request: Request, env: Env, params: Record<string, string>) => {
  try {
    const threadId = params.thread_id;
    if (!threadId) {
      return new Response(JSON.stringify({
        error: { message: 'Thread ID is required' }
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '20');

    // For now, return empty list - in production, you'd implement proper listing
    const response = {
      object: 'list' as const,
      data: [],
      first_id: null,
      last_id: null,
      has_more: false
    };

    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('List messages error:', error);
    return new Response(JSON.stringify({
      error: { message: 'Internal server error' }
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

// Update message
export const updateMessage = async (request: Request, env: Env, params: Record<string, string>) => {
  try {
    const threadId = params.thread_id;
    const messageId = params.message_id;

    if (!threadId || !messageId) {
      return new Response(JSON.stringify({
        error: { message: 'Thread ID and Message ID are required' }
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const body = await request.json();
    const validatedData = UpdateMessageRequest.parse(body);

    const storage = createR2Storage(env.R2_BUCKET);
    const existingMessage = await storage.messages.get(threadId, messageId);

    if (!existingMessage) {
      return new Response(JSON.stringify({
        error: { message: 'Message not found' }
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Update only provided fields
    const updatedMessage: Message = {
      ...existingMessage,
      ...(validatedData.metadata !== undefined && { metadata: validatedData.metadata })
    };

    await storage.messages.put(threadId, updatedMessage);

    return new Response(JSON.stringify(updatedMessage), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return new Response(JSON.stringify({
        error: { message: 'Validation failed', details: error.issues }
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.error('Update message error:', error);
    return new Response(JSON.stringify({
      error: { message: 'Internal server error' }
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

// Delete message
export const deleteMessage = async (request: Request, env: Env, params: Record<string, string>) => {
  try {
    const threadId = params.thread_id;
    const messageId = params.message_id;

    if (!threadId || !messageId) {
      return new Response(JSON.stringify({
        error: { message: 'Thread ID and Message ID are required' }
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const storage = createR2Storage(env.R2_BUCKET);
    const existingMessage = await storage.messages.get(threadId, messageId);

    if (!existingMessage) {
      return new Response(JSON.stringify({
        error: { message: 'Message not found' }
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    await storage.messages.delete(threadId, messageId);

    return new Response(JSON.stringify({
      id: messageId,
      object: 'thread.message.deleted',
      deleted: true
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Delete message error:', error);
    return new Response(JSON.stringify({
      error: { message: 'Internal server error' }
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};