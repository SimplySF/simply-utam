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

import { ParameterTypeRegistry, CucumberExpressionGenerator } from '@cucumber/cucumber-expressions';
import prettier from 'prettier';
import { ParsedGherkinStep, StepSemanticKeyword } from './gherkin-parser.js';

export interface GeneratedStepSnippet {
  keyword: StepSemanticKeyword;
  expression: string;
  parameters: string[];
  fullText: string;
  featureFile: string;
  stepText: string;
}

/**
 * Formats parameter names into clean, non-conflicting JavaScript identifier names.
 *
 * @param names - Raw parameter names from Cucumber expression generator.
 * @param hasDataTable - Whether the step includes a Gherkin data table.
 * @param hasDocString - Whether the step includes a Gherkin doc string.
 * @returns Array of sanitized unique identifier names.
 */
export function formatParameterNames(
  names: readonly string[],
  hasDataTable: boolean = false,
  hasDocString: boolean = false,
): string[] {
  const result: string[] = [];
  const counts: Record<string, number> = {};

  for (const name of names) {
    const sanitized = name.replace(/[^a-zA-Z0-9_$]/g, '') || 'arg';
    counts[sanitized] = (counts[sanitized] || 0) + 1;
  }

  const seen: Record<string, number> = {};
  for (const name of names) {
    const sanitized = name.replace(/[^a-zA-Z0-9_$]/g, '') || 'arg';
    if (counts[sanitized] > 1) {
      seen[sanitized] = (seen[sanitized] || 0) + 1;
      result.push(`${sanitized}${seen[sanitized]}`);
    } else {
      result.push(sanitized);
    }
  }

  if (hasDataTable) {
    result.push('dataTable');
  }
  if (hasDocString) {
    result.push('docString');
  }

  return result;
}

/**
 * Generates an idiomatic Cucumber step definition snippet using CucumberExpressionGenerator.
 *
 * @param step - Parsed Gherkin step.
 * @param registry - Optional Cucumber parameter type registry.
 * @returns Generated snippet object with expression and implementation template.
 */
export function generateStepSnippet(
  step: ParsedGherkinStep,
  registry: ParameterTypeRegistry = new ParameterTypeRegistry(),
): GeneratedStepSnippet {
  const generator = new CucumberExpressionGenerator(() => registry.parameterTypes);
  const generatedList = generator.generateExpressions(step.text);

  let expressionSource = step.text;
  let rawParamNames: readonly string[] = [];

  if (generatedList.length > 0) {
    const bestMatch = generatedList[0];
    expressionSource = bestMatch.source;
    rawParamNames = bestMatch.parameterNames;
  }

  const parameters = formatParameterNames(rawParamNames, step.hasDataTable, step.hasDocString);
  const escapedExpression = expressionSource.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  const fullText = `${step.keyword}('${escapedExpression}', async (${parameters.join(', ')}): Promise<void> => {\n  // Write code here that turns the phrase above into concrete actions\n  throw new Error('Step not implemented');\n});`;

  return {
    keyword: step.keyword,
    expression: expressionSource,
    parameters,
    fullText,
    featureFile: step.filePath,
    stepText: step.text,
  };
}

/**
 * Formats generated JavaScript/TypeScript code using Prettier.
 *
 * @param code - Raw code string to format.
 * @returns Formatted code string.
 */
export async function formatCode(code: string): Promise<string> {
  try {
    return await prettier.format(code, {
      parser: 'typescript',
      singleQuote: true,
      semi: true,
      trailingComma: 'all',
      printWidth: 100,
    });
  } catch {
    return code;
  }
}
