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

import { Parser, AstBuilder, GherkinClassicTokenMatcher } from '@cucumber/gherkin';
import { IdGenerator } from '@cucumber/messages';

export type StepSemanticKeyword = 'Given' | 'When' | 'Then';

export interface ParsedGherkinStep {
  keyword: StepSemanticKeyword;
  rawKeyword: string;
  text: string;
  filePath: string;
  line: number;
  hasDataTable: boolean;
  hasDocString: boolean;
}

interface StepAstNode {
  keyword: string;
  text: string;
  location?: { line: number; column: number };
  dataTable?: { rows?: unknown[] };
  docString?: { content?: string };
}

interface FeatureChildNode {
  background?: { steps?: StepAstNode[] };
  scenario?: { steps?: StepAstNode[] };
  rule?: { children?: FeatureChildNode[] };
}

interface ParsedGherkinDocument {
  feature?: {
    children?: FeatureChildNode[];
  };
}

/**
 * Parses Gherkin source text into an AST using the official @cucumber/gherkin parser.
 *
 * @param content - Gherkin feature source text.
 * @returns Parsed AST document representation.
 */
export function parseGherkinDocument(content: string): ReturnType<Parser<unknown>['parse']> {
  const builder = new AstBuilder(IdGenerator.uuid());
  const matcher = new GherkinClassicTokenMatcher();
  const parser = new Parser(builder, matcher);
  return parser.parse(content);
}

/**
 * Traverses a Gherkin document AST and extracts all scenario, background, and rule steps,
 * normalizing 'And' and 'But' keywords to their semantic parent keyword (Given, When, Then).
 *
 * @param content - Gherkin feature file content.
 * @param filePath - Path to the feature file for error and location reporting.
 * @returns Extracted steps with normalized semantic keywords.
 */
export function extractStepsFromGherkin(
  content: string,
  filePath: string = 'unknown.feature',
): ParsedGherkinStep[] {
  let gherkinDocument: ParsedGherkinDocument | undefined;
  try {
    gherkinDocument = parseGherkinDocument(content) as ParsedGherkinDocument;
  } catch {
    // If parsing fails (e.g. invalid feature syntax), return empty list
    return [];
  }

  if (!gherkinDocument?.feature) {
    return [];
  }

  const steps: ParsedGherkinStep[] = [];

  function processSteps(stepNodes: StepAstNode[]): void {
    let currentKeyword: StepSemanticKeyword = 'Given';

    for (const stepNode of stepNodes) {
      const rawKeyword = stepNode.keyword ? stepNode.keyword.trim() : 'Given';
      const text = stepNode.text ? stepNode.text.trim() : '';

      if (rawKeyword === 'Given') {
        currentKeyword = 'Given';
      } else if (rawKeyword === 'When') {
        currentKeyword = 'When';
      } else if (rawKeyword === 'Then') {
        currentKeyword = 'Then';
      }
      // 'And' or 'But' inherit currentKeyword

      steps.push({
        keyword: currentKeyword,
        rawKeyword,
        text,
        filePath,
        line: stepNode.location?.line ?? 0,
        hasDataTable: Boolean(stepNode.dataTable?.rows && stepNode.dataTable.rows.length > 0),
        hasDocString: Boolean(stepNode.docString?.content),
      });
    }
  }

  const children = gherkinDocument.feature.children ?? [];
  for (const child of children) {
    if (Array.isArray(child.background?.steps)) {
      processSteps(child.background.steps);
    }
    if (Array.isArray(child.scenario?.steps)) {
      processSteps(child.scenario.steps);
    }
    if (Array.isArray(child.rule?.children)) {
      for (const ruleChild of child.rule.children) {
        if (Array.isArray(ruleChild.background?.steps)) {
          processSteps(ruleChild.background.steps);
        }
        if (Array.isArray(ruleChild.scenario?.steps)) {
          processSteps(ruleChild.scenario.steps);
        }
      }
    }
  }

  return steps;
}
