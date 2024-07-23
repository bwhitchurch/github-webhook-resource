#!/usr/bin/env node

'use strict';

import { Octokit } from '@octokit/core';
import _ from 'lodash';
import * as validate from './validate.js';
const env = process.env;
const stdin = process.stdin;

stdin.setEncoding('utf8');

let inputChunks = [];
stdin.on('data', function (chunk) {
    inputChunks.push(chunk);
});

stdin.on('end', function () {
    const input = inputChunks.join('');
    if (!input) {
        log('STDIN ended with empty input. Exiting.');
        return;
    }

    let resourceConfig;
    try {
        resourceConfig = JSON.parse(input);
        validate.env(process.env);
        validate.config(resourceConfig);
    } catch(error) {
        log(`Error: ${error.message}`);
        process.exit(1);
    }

    const source = resourceConfig.source || {};
    const params = resourceConfig.params || {};

    if (params.events === undefined || params.events.length === 0) {
        params.events = ['push']
    }

    // Remove duplicates
    params.events = [...new Set(params.events)];

    processWebhook(source, params);
});

function buildUrl(source, params) {
    const instanceVars = buildInstanceVariables(params);
    const payloadBaseUrl = params.payload_base_url ? params.payload_base_url : env.ATC_EXTERNAL_URL;
    const pipeline = params.pipeline ? params.pipeline : env.BUILD_PIPELINE_NAME;

    return encodeURI(`${payloadBaseUrl}/api/v1/teams/${env.BUILD_TEAM_NAME}/pipelines/${pipeline}/resources/${params.resource_name}/check/webhook?webhook_token=${params.webhook_token}${instanceVars}`);
}

function buildInstanceVariables(params) {
    let vars = "";
    if (env.BUILD_PIPELINE_INSTANCE_VARS) {
        try {
            const instanceVars = JSON.parse(env.BUILD_PIPELINE_INSTANCE_VARS)
            for (const [key, value] of Object.entries(instanceVars)) {
                vars += `&vars.${key}="${value}"`;
            }
        } catch(exception) {
            throw new Error(exception);
        }
    }
    if ("pipeline_instance_vars" in params && params.pipeline_instance_vars) {
        try {
            for (const [key, value] of Object.entries(params.pipeline_instance_vars)) {
                vars += `&vars.${key}="${value}"`;
            }
        } catch(exception) {
            throw new Error(exception);
        }
    }
    return vars;
}

async function processWebhook(source, params) {

    const webhookEndpoint = `/repos/${params.org}/${params.repo}/hooks`;
    const url = buildUrl(source, params)

    log(`Webhook location: ${webhookEndpoint}\n` +
        `Target Concourse resource: ${url}\n`);

    const config = {
        'url': url,
        'content_type': params.payload_content_type ? params.payload_content_type : 'json',
        'insecure_ssl': 0
    };

    let body = {
        'owner': params.org,
        'repo': params.repo,
        'name': 'web',
        'active': true,
        'config': config,
        'events': params.events,
        'headers': {
            'X-GitHub-Api-Version': '2022-11-28'
        }
    };

    const octokit = new Octokit({
        auth: source.github_token
    })

    const existingHookResponse = await octokit.request('GET ' + webhookEndpoint, {owner: params.org, repo: params.repo});
    const existingHookList = existingHookResponse.data;
    const existingHook = existingHookList.find(hook => _.isMatch(hook.config.url, config.url));


    switch (params.operation) {
        case 'create':
            if (existingHook == null) {
                const result = await octokit.request('POST ' + webhookEndpoint, body)
                emit(result.data);
            }
            else if (!_.isEqual(_.sortBy(existingHook.events), _.sortBy(body.events))) {
                body.hook_id = existingHook.id;
                const result = await octokit.request('PATCH ' + webhookEndpoint + '/' + existingHook.id, body)
                emit(result.data);
            } else {
                log('Webhook already exists');
                emit(existingHook);
            }
            break;
        case 'delete':
            if (existingHook == null) {
                log('Webhook does not exist');
                emit({id: Date.now()});
            } else {
                body.hook_id = existingHook.id;
                const result = await octokit.request('DELETE ' + webhookEndpoint + '/' + existingHook.id)
                emit({id: Date.now()});
            }
            break;
    }
}

function emit(result) {
    const output = {
        version: {
            id: result.id.toString()
        }
    };

    // Output version to Concourse using stdout
    console.log(JSON.stringify(output, null, 2));

    process.exit(0);
}

function log(message) {
    // Concourse only prints stderr to user
    console.error(message);
}

export { buildInstanceVariables, buildUrl };
