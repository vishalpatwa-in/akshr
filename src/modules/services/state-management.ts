import { Run, RunStatus, RunError } from '../models/run';
import { ServiceConfig, ServiceResult } from './types';
import { ServiceUtils } from './utils';

/**
 * State transition definition
 */
export interface StateTransition {
  from: RunStatus;
  to: RunStatus;
  allowed: boolean;
  requiresValidation?: boolean;
  sideEffects?: string[];
}

/**
 * State transition context
 */
export interface TransitionContext {
  userId?: string;
  reason?: string;
  metadata?: Record<string, any>;
  timestamp: number;
}

/**
 * State transition result
 */
export interface TransitionResult {
  success: boolean;
  run: Run;
  previousStatus: RunStatus;
  newStatus: RunStatus;
  error?: string;
  transitionId: string;
}

/**
 * Run State Manager handles atomic state transitions and validation
 */
export class RunStateManager {
  private readonly config: ServiceConfig;
  private readonly validTransitions: Map<RunStatus, RunStatus[]>;

  constructor(config: ServiceConfig) {
    this.config = config;
    this.validTransitions = this.initializeValidTransitions();
  }

  /**
   * Initialize valid state transitions
   */
  private initializeValidTransitions(): Map<RunStatus, RunStatus[]> {
    const transitions = new Map<RunStatus, RunStatus[]>();

    transitions.set('queued', ['in_progress', 'cancelled']);
    transitions.set('in_progress', ['requires_tool_actions', 'completed', 'failed', 'cancelled']);
    transitions.set('requires_tool_actions', ['in_progress', 'cancelled']);
    transitions.set('completed', []); // Terminal state
    transitions.set('failed', []); // Terminal state
    transitions.set('cancelled', []); // Terminal state

    return transitions;
  }

  /**
   * Validate if a state transition is allowed
   */
  validateTransition(from: RunStatus, to: RunStatus): { valid: boolean; reason?: string } {
    const allowedStates = this.validTransitions.get(from);

    if (!allowedStates) {
      return { valid: false, reason: `No transitions defined from state '${from}'` };
    }

    if (!allowedStates.includes(to)) {
      return {
        valid: false,
        reason: `Transition from '${from}' to '${to}' is not allowed. Allowed transitions: ${allowedStates.join(', ')}`
      };
    }

    return { valid: true };
  }

  /**
   * Execute atomic state transition with CAS
   */
  async transitionState(
    threadId: string,
    runId: string,
    newStatus: RunStatus,
    context: TransitionContext = { timestamp: Date.now() },
    error?: RunError
  ): Promise<ServiceResult<TransitionResult>> {
    try {
      // Get current run state
      const currentRun = await this.config.storage.runs.get(threadId, runId);
      if (!currentRun) {
        return {
          success: false,
          error: 'Run not found',
          code: 'NOT_FOUND_ERROR'
        };
      }

      // Validate transition
      const validation = this.validateTransition(currentRun.status, newStatus);
      if (!validation.valid) {
        return {
          success: false,
          error: validation.reason,
          code: 'INVALID_TRANSITION'
        };
      }

      // Prepare updated run
      const updatedRun: Run = {
        ...currentRun,
        status: newStatus,
        last_error: error
      };

      // Set timestamps based on status
      if (newStatus === 'in_progress' && !currentRun.started_at) {
        updatedRun.started_at = context.timestamp;
      } else if ((newStatus === 'completed' || newStatus === 'failed' || newStatus === 'cancelled') && !currentRun.completed_at) {
        updatedRun.completed_at = context.timestamp;
      }

      // Execute atomic update with CAS
      const updateResult = await this.atomicUpdate(threadId, runId, updatedRun, currentRun);

      if (!updateResult.success) {
        return {
          success: false,
          error: updateResult.error || 'Concurrent modification detected',
          code: 'CONCURRENT_MODIFICATION'
        };
      }

      const transitionResult: TransitionResult = {
        success: true,
        run: updatedRun,
        previousStatus: currentRun.status,
        newStatus,
        transitionId: this.generateTransitionId()
      };

      // Log transition for audit
      await this.logTransition(transitionResult, context);

      return { success: true, data: transitionResult };
    } catch (error) {
      console.error('Error in state transition:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'State transition failed',
        code: 'TRANSITION_ERROR'
      };
    }
  }

  /**
   * Batch transition multiple runs (useful for cleanup operations)
   */
  async batchTransition(
    transitions: Array<{
      threadId: string;
      runId: string;
      newStatus: RunStatus;
      context?: TransitionContext;
      error?: RunError;
    }>
  ): Promise<ServiceResult<TransitionResult[]>> {
    try {
      const results: TransitionResult[] = [];

      for (const transition of transitions) {
        const result = await this.transitionState(
          transition.threadId,
          transition.runId,
          transition.newStatus,
          transition.context,
          transition.error
        );

        if (result.success && result.data) {
          results.push(result.data);
        } else {
          console.error(`Failed to transition run ${transition.runId}:`, result.error);
        }
      }

      return { success: true, data: results };
    } catch (error) {
      console.error('Error in batch transition:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Batch transition failed',
        code: 'BATCH_TRANSITION_ERROR'
      };
    }
  }

  /**
   * Get state transition history for a run
   */
  async getTransitionHistory(threadId: string, runId: string): Promise<ServiceResult<any[]>> {
    try {
      // This would typically read from a separate audit log storage
      // For now, return empty history
      return { success: true, data: [] };
    } catch (error) {
      console.error('Error getting transition history:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get transition history',
        code: 'HISTORY_RETRIEVAL_ERROR'
      };
    }
  }

  /**
   * Force transition (admin operation for recovery)
   */
  async forceTransition(
    threadId: string,
    runId: string,
    newStatus: RunStatus,
    reason: string,
    context: TransitionContext = { timestamp: Date.now() }
  ): Promise<ServiceResult<TransitionResult>> {
    try {
      console.warn(`Force transitioning run ${runId} to ${newStatus}. Reason: ${reason}`);

      // Get current run state
      const currentRun = await this.config.storage.runs.get(threadId, runId);
      if (!currentRun) {
        return {
          success: false,
          error: 'Run not found',
          code: 'NOT_FOUND_ERROR'
        };
      }

      // Skip validation for force transitions
      const updatedRun: Run = {
        ...currentRun,
        status: newStatus
      };

      // Set timestamps
      if (newStatus === 'in_progress' && !currentRun.started_at) {
        updatedRun.started_at = context.timestamp;
      } else if ((newStatus === 'completed' || newStatus === 'failed' || newStatus === 'cancelled') && !currentRun.completed_at) {
        updatedRun.completed_at = context.timestamp;
      }

      // Force update (bypass CAS for emergency recovery)
      await this.config.storage.runs.put(threadId, updatedRun);

      const transitionResult: TransitionResult = {
        success: true,
        run: updatedRun,
        previousStatus: currentRun.status,
        newStatus,
        transitionId: this.generateTransitionId()
      };

      // Log force transition with reason
      await this.logTransition(transitionResult, {
        ...context,
        reason: `FORCE: ${reason}`
      });

      return { success: true, data: transitionResult };
    } catch (error) {
      console.error('Error in force transition:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Force transition failed',
        code: 'FORCE_TRANSITION_ERROR'
      };
    }
  }

  /**
   * Get runs by status for cleanup operations
   */
  async getRunsByStatus(status: RunStatus, limit: number = 100): Promise<ServiceResult<Run[]>> {
    try {
      // This would require a more sophisticated storage implementation
      // For now, return empty array
      return { success: true, data: [] };
    } catch (error) {
      console.error('Error getting runs by status:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get runs by status',
        code: 'STATUS_QUERY_ERROR'
      };
    }
  }

  /**
   * Cleanup expired runs
   */
  async cleanupExpiredRuns(): Promise<ServiceResult<{ cleaned: number; errors: string[] }>> {
    try {
      const now = Math.floor(Date.now() / 1000);
      const errors: string[] = [];
      let cleaned = 0;

      // This would require listing all runs and checking expiration
      // For now, return empty result
      return {
        success: true,
        data: { cleaned, errors }
      };
    } catch (error) {
      console.error('Error cleaning up expired runs:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Cleanup failed',
        code: 'CLEANUP_ERROR'
      };
    }
  }

  /**
   * Atomic update using CAS
   */
  private async atomicUpdate(
    threadId: string,
    runId: string,
    updatedRun: Run,
    expectedCurrent: Run
  ): Promise<ServiceResult<Run>> {
    try {
      // Use the storage's updateWithCas method
      const updateResult = await this.config.storage.runs.updateWithCas(
        threadId,
        runId,
        (current) => {
          if (!current) {
            throw new Error('Run not found');
          }
          // Verify the current state matches what we expect
          if (current.status !== expectedCurrent.status) {
            throw new Error('Concurrent modification detected');
          }
          return updatedRun;
        }
      );

      if (!updateResult.success) {
        return {
          success: false,
          error: updateResult.error || 'CAS update failed',
          code: 'CAS_UPDATE_ERROR'
        };
      }

      return { success: true, data: updatedRun };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Atomic update failed',
        code: 'ATOMIC_UPDATE_ERROR'
      };
    }
  }

  /**
   * Generate unique transition ID
   */
  private generateTransitionId(): string {
    return `transition_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Log transition for audit purposes
   */
  private async logTransition(
    transition: TransitionResult,
    context: TransitionContext
  ): Promise<void> {
    try {
      // This would typically write to an audit log storage
      console.log(`Run transition: ${transition.previousStatus} -> ${transition.newStatus}`, {
        runId: transition.run.id,
        transitionId: transition.transitionId,
        context
      });
    } catch (error) {
      console.error('Error logging transition:', error);
      // Don't fail the transition if logging fails
    }
  }

  /**
   * Get state statistics
   */
  async getStateStatistics(): Promise<ServiceResult<Record<RunStatus, number>>> {
    try {
      // This would require aggregating data from storage
      // For now, return empty stats
      const stats: Record<RunStatus, number> = {
        queued: 0,
        in_progress: 0,
        requires_tool_actions: 0,
        completed: 0,
        failed: 0,
        cancelled: 0
      };

      return { success: true, data: stats };
    } catch (error) {
      console.error('Error getting state statistics:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get state statistics',
        code: 'STATISTICS_ERROR'
      };
    }
  }
}