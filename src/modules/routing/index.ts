/**
 * OpenAI Assistant API Routing Configuration
 * Main entry point for all /v1 endpoints
 */

import { router } from './router';
import { authMiddleware, corsMiddleware, contentTypeMiddleware } from './middleware';

// Import all handlers
import * as assistantHandlers from './handlers/assistants';
import * as threadHandlers from './handlers/threads';
import * as messageHandlers from './handlers/messages';
import * as runHandlers from './handlers/runs';
import * as fileHandlers from './handlers/files';
import * as gcHandlers from './handlers/gc';

// Global middleware
router.use(corsMiddleware);
router.use(authMiddleware);

// Assistant endpoints
router.post('/v1/assistants', assistantHandlers.createAssistant);
router.get('/v1/assistants', assistantHandlers.listAssistants);
router.get('/v1/assistants/{assistant_id}', assistantHandlers.getAssistant);
router.post('/v1/assistants/{assistant_id}', assistantHandlers.updateAssistant);
router.delete('/v1/assistants/{assistant_id}', assistantHandlers.deleteAssistant);

// Thread endpoints
router.post('/v1/threads', threadHandlers.createThread);
router.get('/v1/threads/{thread_id}', threadHandlers.getThread);
router.post('/v1/threads/{thread_id}', threadHandlers.updateThread);
router.delete('/v1/threads/{thread_id}', threadHandlers.deleteThread);

// Message endpoints
router.post('/v1/threads/{thread_id}/messages', messageHandlers.createMessage);
router.get('/v1/threads/{thread_id}/messages', messageHandlers.listMessages);
router.get('/v1/threads/{thread_id}/messages/{message_id}', messageHandlers.getMessage);
router.post('/v1/threads/{thread_id}/messages/{message_id}', messageHandlers.updateMessage);
router.delete('/v1/threads/{thread_id}/messages/{message_id}', messageHandlers.deleteMessage);

// Run endpoints
router.post('/v1/threads/{thread_id}/runs', runHandlers.createRun);
router.get('/v1/threads/{thread_id}/runs', runHandlers.listRuns);
router.get('/v1/threads/{thread_id}/runs/{run_id}', runHandlers.getRun);
router.post('/v1/threads/{thread_id}/runs/{run_id}/cancel', runHandlers.cancelRun);
router.post('/v1/threads/{thread_id}/runs/{run_id}/submit_tool_outputs', runHandlers.submitToolOutputs);

// File endpoints
router.post('/v1/files', fileHandlers.uploadFile);
router.get('/v1/files/{file_id}', fileHandlers.getFile);
router.get('/v1/files/{file_id}/content', fileHandlers.getFileContent);
router.delete('/v1/files/{file_id}', fileHandlers.deleteFile);

// GC Admin endpoints
router.post('/admin/gc', gcHandlers.triggerGC);
router.get('/admin/gc/config', gcHandlers.getGCConfig);
router.post('/admin/gc/dry-run', gcHandlers.dryRunGC);
router.get('/admin/gc/status/{operationId}', gcHandlers.getGCStatus);

// Stream endpoint (placeholder for now)
router.post('/v1/threads/{thread_id}/runs/{run_id}/stream', async (request, env, params) => {
  // Placeholder for streaming implementation
  return new Response(JSON.stringify({
    error: { message: 'Streaming not yet implemented' }
  }), {
    status: 501,
    headers: { 'Content-Type': 'application/json' }
  });
});

export { router };