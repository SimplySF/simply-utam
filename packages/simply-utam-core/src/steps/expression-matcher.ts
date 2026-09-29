/*
 * Copyright (c) 2026, SimplySF.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  ParameterTypeRegistry,
  CucumberExpression,
  RegularExpression,
  Expression,
} from '@cucumber/cucumber-expressions';

export interface RawExtractedExpression {
  pattern: string;
  isRegex: boolean;
  flags?: string;
}

export interface CompiledStepExpression {
  source: string;
  isRegex: boolean;
  expression: Expression;
}

/**
 * Normalizes expression strings to eliminate trivial escaping variations when comparing.
 *
 * @param expr - Raw expression string.
 * @returns Normalized expression string.
 */
export function normalizeExpression(expr: string): string {
  return expr.trim().replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

/**
 * Statically parses step definition file content to extract registered step expressions
 * without executing the file or loading modules at runtime.
 *
 * @param content - File content of step definitions.
 * @returns Array of raw extracted string and regexp patterns.
 */
export function extractStepExpressionsFromContent(content: string): RawExtractedExpression[] {
  const expressions: RawExtractedExpression[] = [];

  // Match string step definitions: Given('...', ...), When("...", ...), Then(`...`, ...)
  const stringRegex = /(?:Given|When|Then|Step|DefineStep)\s*\(\s*(['"`])([\s\S]*?)\1\s*,/g;
  let match: RegExpExecArray | null;
  while ((match = stringRegex.exec(content)) !== null) {
    expressions.push({
      pattern: match[2],
      isRegex: false,
    });
  }

  // Match RegExp step definitions: Given(/^...$/, ...), When(/.../i, ...)
  const regexRegex =
    /(?:Given|When|Then|Step|DefineStep)\s*\(\s*\/((?:\\\/|[^/\r\n])+)\/([a-z]*)\s*,/g;
  while ((match = regexRegex.exec(content)) !== null) {
    expressions.push({
      pattern: match[1],
      isRegex: true,
      flags: match[2],
    });
  }

  return expressions;
}

/**
 * Compiles raw extracted expressions into official Cucumber expression matchers.
 *
 * @param rawExpressions - Raw extracted expression definitions.
 * @param registry - Optional Cucumber parameter type registry.
 * @returns Array of compiled step expressions ready for matching.
 */
export function compileStepExpressions(
  rawExpressions: RawExtractedExpression[],
  registry: ParameterTypeRegistry = new ParameterTypeRegistry(),
): CompiledStepExpression[] {
  const compiled: CompiledStepExpression[] = [];

  for (const raw of rawExpressions) {
    try {
      if (raw.isRegex) {
        const regex = new RegExp(raw.pattern, raw.flags ?? '');
        const regExpr = new RegularExpression(regex, registry);
        compiled.push({
          source: raw.pattern,
          isRegex: true,
          expression: regExpr,
        });
      } else {
        const cucExpr = new CucumberExpression(raw.pattern, registry);
        compiled.push({
          source: raw.pattern,
          isRegex: false,
          expression: cucExpr,
        });
      }
    } catch {
      // Gracefully ignore expressions with invalid syntax
    }
  }

  return compiled;
}

/**
 * Checks if a given Gherkin step text matches any registered step definition expression.
 *
 * @param stepText - Raw step phrase text from a feature file.
 * @param compiledExpressions - Compiled step expressions to test against.
 * @returns True if a match is found, false otherwise.
 */
export function matchStepAgainstExpressions(
  stepText: string,
  compiledExpressions: CompiledStepExpression[],
): boolean {
  for (const item of compiledExpressions) {
    const args = item.expression.match(stepText);
    if (args !== null) {
      return true;
    }
  }
  return false;
}
