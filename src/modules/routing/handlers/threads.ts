/**
 * Threads API Handlers
 * Implements CRUD operations for threads
 */

import { z } from 'zod';
import type { Env } from '../../../index';
import { createR2Storage } from '../../r2-helpers';
import {
  CreateThreadRequest,
  UpdateThreadRequest,
  ThreadResponse
} from '../../validators';
import type { Thread } from '../../models';

// Generate unique ID
const generateId = () => crypto.randomUUID();

// Create thread
export const createThread = async (request: Request, env: Env, params: Record<string, string>) => {
  try {
    const body = await request.json();
    const validatedData = CreateThreadRequest.parse(body);

    const storage = createR2Storage(env.R2_BUCKET);
    const threadId = generateId();

    const thread: Thread = {
      id: threadId,
      object: 'thread',
      created_at: Math.floor(Date.now() / 1000),
      metadata: validatedData.metadata
    };

    await storage.threads.put(thread);

    return new Response(JSON.stringify(thread), {
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

    console.error('Create thread error:', error);
    return new Response(JSON.stringify({
      error: { message: 'Internal server error' }
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

// Get thread
export const getThread = async (request: Request, env: Env, params: Record<string, string>) => {
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

    const storage = createR2Storage(env.R2_BUCKET);
    const thread = await storage.threads.get(threadId);

    if (!thread) {
      return new Response(JSON.stringify({
        error: { message: 'Thread not found' }
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify(thread), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Get thread error:', error);
    return new Response(JSON.stringify({
      error: { message: 'Internal server error' }
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

// Update thread
export const updateThread = async (request: Request, env: Env, params: Record<string, string>) => {
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
    const validatedData = UpdateThreadRequest.parse(body);

    const storage = createR2Storage(env.R2_BUCKET);
    const existingThread = await storage.threads.get(threadId);

    if (!existingThread) {
      return new Response(JSON.stringify({
        error: { message: 'Thread not found' }
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Update only provided fields
    const updatedThread: Thread = {
      ...existingThread,
      ...(validatedData.metadata !== undefined && { metadata: validatedData.metadata })
    };

    await storage.threads.put(updatedThread);

    return new Response(JSON.stringify(updatedThread), {
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

    console.error('Update thread error:', error);
    return new Response(JSON.stringify({
      error: { message: 'Internal server error' }
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

// Delete thread
export const deleteThread = async (request: Request, env: Env, params: Record<string, string>) => {
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

    const storage = createR2Storage(env.R2_BUCKET);
    const existingThread = await storage.threads.get(threadId);

    if (!existingThread) {
      return new Response(JSON.stringify({
        error: { message: 'Thread not found' }
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    await storage.threads.delete(threadId);

    return new Response(JSON.stringify({
      id: threadId,
      object: 'thread.deleted',
      deleted: true
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Delete thread error:', error);
    return new Response(JSON.stringify({
      error: { message: 'Internal server error' }
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};