/**
 * Assistants API Handlers
 * Implements CRUD operations for assistants
 */

import { z } from 'zod';
import type { Env } from '../../../index';
import { createR2Storage } from '../../r2-helpers';
import {
  CreateAssistantRequest,
  UpdateAssistantRequest,
  AssistantResponse,
  ListAssistantsResponse
} from '../../validators';
import type { Assistant } from '../../models';

// Generate unique ID
const generateId = () => crypto.randomUUID();

// Create assistant
export const createAssistant = async (request: Request, env: Env, params: Record<string, string>) => {
  try {
    const body = await request.json();
    const validatedData = CreateAssistantRequest.parse(body);

    const storage = createR2Storage(env.R2_BUCKET);
    const assistantId = generateId();

    const assistant: Assistant = {
      id: assistantId,
      object: 'assistant',
      created_at: Math.floor(Date.now() / 1000),
      name: validatedData.name,
      description: validatedData.description,
      instructions: validatedData.instructions,
      model: validatedData.model,
      tools: validatedData.tools || [],
      file_ids: validatedData.file_ids,
      metadata: validatedData.metadata
    };

    await storage.assistants.put(assistant);

    return new Response(JSON.stringify(assistant), {
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

    console.error('Create assistant error:', error);
    return new Response(JSON.stringify({
      error: { message: 'Internal server error' }
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

// Get assistant
export const getAssistant = async (request: Request, env: Env, params: Record<string, string>) => {
  try {
    const assistantId = params.assistant_id;
    if (!assistantId) {
      return new Response(JSON.stringify({
        error: { message: 'Assistant ID is required' }
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const storage = createR2Storage(env.R2_BUCKET);
    const assistant = await storage.assistants.get(assistantId);

    if (!assistant) {
      return new Response(JSON.stringify({
        error: { message: 'Assistant not found' }
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify(assistant), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Get assistant error:', error);
    return new Response(JSON.stringify({
      error: { message: 'Internal server error' }
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

// List assistants (simplified implementation - in production, you'd want proper pagination)
export const listAssistants = async (request: Request, env: Env, params: Record<string, string>) => {
  try {
    // For now, return empty list - in production, you'd implement proper listing
    // This would require either maintaining an index or using R2's list functionality
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
    console.error('List assistants error:', error);
    return new Response(JSON.stringify({
      error: { message: 'Internal server error' }
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

// Update assistant
export const updateAssistant = async (request: Request, env: Env, params: Record<string, string>) => {
  try {
    const assistantId = params.assistant_id;
    if (!assistantId) {
      return new Response(JSON.stringify({
        error: { message: 'Assistant ID is required' }
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const body = await request.json();
    const validatedData = UpdateAssistantRequest.parse(body);

    const storage = createR2Storage(env.R2_BUCKET);
    const existingAssistant = await storage.assistants.get(assistantId);

    if (!existingAssistant) {
      return new Response(JSON.stringify({
        error: { message: 'Assistant not found' }
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Update only provided fields
    const updatedAssistant: Assistant = {
      ...existingAssistant,
      ...(validatedData.name !== undefined && { name: validatedData.name }),
      ...(validatedData.description !== undefined && { description: validatedData.description }),
      ...(validatedData.instructions !== undefined && { instructions: validatedData.instructions }),
      ...(validatedData.model !== undefined && { model: validatedData.model }),
      ...(validatedData.tools !== undefined && { tools: validatedData.tools }),
      ...(validatedData.file_ids !== undefined && { file_ids: validatedData.file_ids }),
      ...(validatedData.metadata !== undefined && { metadata: validatedData.metadata })
    };

    await storage.assistants.put(updatedAssistant);

    return new Response(JSON.stringify(updatedAssistant), {
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

    console.error('Update assistant error:', error);
    return new Response(JSON.stringify({
      error: { message: 'Internal server error' }
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

// Delete assistant
export const deleteAssistant = async (request: Request, env: Env, params: Record<string, string>) => {
  try {
    const assistantId = params.assistant_id;
    if (!assistantId) {
      return new Response(JSON.stringify({
        error: { message: 'Assistant ID is required' }
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const storage = createR2Storage(env.R2_BUCKET);
    const existingAssistant = await storage.assistants.get(assistantId);

    if (!existingAssistant) {
      return new Response(JSON.stringify({
        error: { message: 'Assistant not found' }
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    await storage.assistants.delete(assistantId);

    return new Response(JSON.stringify({
      id: assistantId,
      object: 'assistant.deleted',
      deleted: true
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Delete assistant error:', error);
    return new Response(JSON.stringify({
      error: { message: 'Internal server error' }
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};