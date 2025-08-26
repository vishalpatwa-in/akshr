/**
 * Centralized Router for OpenAI Assistant API
 * Handles all /v1 endpoints with method/path matching and middleware support
 */

import { z } from 'zod';
import type { Env } from '../../index';

// Route handler type
export type RouteHandler = (request: Request, env: Env, params: Record<string, string>) => Promise<Response>;

// Route definition
export interface Route {
  method: string;
  path: string;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
  middleware?: RouteHandler[];
}

// Middleware function type
export type Middleware = (request: Request, env: Env, params: Record<string, string>) => Promise<Response | null>;

// Router class
export class Router {
  private routes: Route[] = [];
  private middleware: Middleware[] = [];

  // Add global middleware
  use(middleware: Middleware) {
    this.middleware.push(middleware);
  }

  // Add route
  addRoute(method: string, path: string, handler: RouteHandler, middleware?: RouteHandler[]) {
    const { pattern, paramNames } = this.parsePath(path);
    this.routes.push({
      method: method.toUpperCase(),
      path,
      pattern,
      paramNames,
      handler,
      middleware
    });
  }

  // Convenience methods for HTTP verbs
  get(path: string, handler: RouteHandler, middleware?: RouteHandler[]) {
    this.addRoute('GET', path, handler, middleware);
  }

  post(path: string, handler: RouteHandler, middleware?: RouteHandler[]) {
    this.addRoute('POST', path, handler, middleware);
  }

  put(path: string, handler: RouteHandler, middleware?: RouteHandler[]) {
    this.addRoute('PUT', path, handler, middleware);
  }

  delete(path: string, handler: RouteHandler, middleware?: RouteHandler[]) {
    this.addRoute('DELETE', path, handler, middleware);
  }

  // Parse path with parameters (e.g., /v1/assistants/{id} -> /v1/assistants/([^/]+))
  private parsePath(path: string): { pattern: RegExp; paramNames: string[] } {
    const paramNames: string[] = [];
    const regexPath = path.replace(/\{([^}]+)\}/g, (match, paramName) => {
      paramNames.push(paramName);
      return '([^/]+)';
    });

    return {
      pattern: new RegExp(`^${regexPath}$`),
      paramNames
    };
  }

  // Extract parameters from path
  private extractParams(pattern: RegExp, paramNames: string[], path: string): Record<string, string> {
    const match = path.match(pattern);
    if (!match) return {};

    const params: Record<string, string> = {};
    paramNames.forEach((name, index) => {
      params[name] = match[index + 1];
    });

    return params;
  }

  // Handle request
  async handle(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();

    // Find matching route
    for (const route of this.routes) {
      if (route.method === method && route.pattern.test(path)) {
        const params = this.extractParams(route.pattern, route.paramNames, path);

        // Run global middleware
        for (const middleware of this.middleware) {
          const response = await middleware(request, env, params);
          if (response) return response; // Middleware returned a response (e.g., auth failure)
        }

        // Run route-specific middleware
        if (route.middleware) {
          for (const middleware of route.middleware) {
            const response = await middleware(request, env, params);
            if (response) return response;
          }
        }

        // Run handler
        try {
          return await route.handler(request, env, params);
        } catch (error) {
          console.error(`Error in route ${method} ${path}:`, error);
          return new Response(JSON.stringify({
            error: { message: 'Internal server error' }
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
    }

    // No route found
    return new Response(JSON.stringify({
      error: { message: 'Not Found' }
    }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Get all routes (for debugging/testing)
  getRoutes(): Route[] {
    return this.routes;
  }
}

// Create main router instance
export const router = new Router();