import { create } from 'zustand';
import { Agent, AgentNode, AgentRelation, Skill, AgentSkill, ChatMessage } from '../types';
import { agentApi, relationApi, skillApi, agentSkillApi } from '../services/api';

interface AppState {
  // Agents
  agents: Agent[];
  agentNodes: AgentNode[];
  selectedAgent: Agent | null;
  isLoadingAgents: boolean;
  
  // Relations
  relations: AgentRelation[];
  isLoadingRelations: boolean;
  
  // Skills
  skills: Skill[];
  isLoadingSkills: boolean;
  
  // Agent Private Skills
  agentPrivateSkills: AgentSkill[];
  selectedSkillAgentId: string | null;
  isLoadingPrivateSkills: boolean;
  
  // Chat
  currentChatAgent: Agent | null;
  chatMessages: ChatMessage[];
  isChatLoading: boolean;
  
  // Actions
  fetchAgents: () => Promise<void>;
  fetchAgentNodes: () => Promise<void>;
  createAgent: (data: Partial<Agent>) => Promise<void>;
  updateAgent: (id: string, data: Partial<Agent>) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;
  selectAgent: (agent: Agent | null) => void;
  updateAgentPosition: (id: string, x: number, y: number) => Promise<void>;
  
  fetchRelations: () => Promise<void>;
  createRelation: (data: Partial<AgentRelation>) => Promise<void>;
  updateRelation: (id: string, data: Partial<AgentRelation>) => Promise<void>;
  deleteRelation: (id: string) => Promise<void>;
  
  fetchSkills: () => Promise<void>;
  
  fetchAgentPrivateSkills: (agentId: string) => Promise<void>;
  installAgentSkill: (agentId: string, data: Parameters<typeof agentSkillApi.install>[1]) => Promise<AgentSkill>;
  uninstallAgentSkill: (agentId: string, skillId: string) => Promise<void>;
  toggleAgentSkill: (agentId: string, skillId: string, enabled: boolean) => Promise<void>;
  setPersonaMode: (agentId: string, skillId: string, mode: 'on' | 'off') => Promise<void>;
  
  setCurrentChatAgent: (agent: Agent | null) => void;
  setChatMessages: (messages: ChatMessage[]) => void;
  addChatMessage: (message: ChatMessage) => void;
}

export const useAppStore = create<AppState>((set) => ({
  // Initial state
  agents: [],
  agentNodes: [],
  selectedAgent: null,
  isLoadingAgents: false,
  relations: [],
  isLoadingRelations: false,
  skills: [],
  isLoadingSkills: false,
  agentPrivateSkills: [],
  selectedSkillAgentId: null,
  isLoadingPrivateSkills: false,
  currentChatAgent: null,
  chatMessages: [],
  isChatLoading: false,

  // Agent actions
  fetchAgents: async () => {
    set({ isLoadingAgents: true });
    try {
      const response = await agentApi.getAll();
      set({ agents: response.data.data });
    } catch (error) {
      console.error('Failed to fetch agents:', error);
    } finally {
      set({ isLoadingAgents: false });
    }
  },

  fetchAgentNodes: async () => {
    try {
      const response = await agentApi.getNodes();
      set({ agentNodes: response.data.data });
    } catch (error) {
      console.error('Failed to fetch agent nodes:', error);
    }
  },

  createAgent: async (data) => {
    try {
      console.log('Creating agent with data:', data);
      const response = await agentApi.create(data);
      console.log('Create agent response:', response.data);
      
      if (!response.data.success) {
        throw new Error('创建失败');
      }
      
      const newAgent = response.data.data;
      if (!newAgent || !newAgent.id) {
        console.error('Invalid agent data:', newAgent);
        throw new Error('返回数据格式错误');
      }
      
      console.log('Adding new agent to state:', newAgent);
      set((state) => {
        const newState = { 
          agents: [...state.agents, newAgent],
          agentNodes: [...state.agentNodes, {
            id: newAgent.id,
            position: { x: Math.random() * 400, y: Math.random() * 300 },
            data: newAgent
          }]
        };
        console.log('New state:', newState);
        return newState;
      });
    } catch (error) {
      console.error('Failed to create agent:', error);
      throw error;
    }
  },

  updateAgent: async (id, data) => {
    try {
      const response = await agentApi.update(id, data);
      const updatedAgent = response.data.data;
      set((state) => ({
        agents: state.agents.map((a) => (a.id === id ? updatedAgent : a)),
        agentNodes: state.agentNodes.map((n) => 
          n.id === id ? { ...n, data: updatedAgent } : n
        ),
        selectedAgent: state.selectedAgent?.id === id ? updatedAgent : state.selectedAgent,
      }));
    } catch (error) {
      console.error('Failed to update agent:', error);
      throw error;
    }
  },

  deleteAgent: async (id) => {
    try {
      await agentApi.delete(id);
      set((state) => ({
        agents: state.agents.filter((a) => a.id !== id),
        agentNodes: state.agentNodes.filter((n) => n.id !== id),
        selectedAgent: state.selectedAgent?.id === id ? null : state.selectedAgent,
      }));
    } catch (error) {
      console.error('Failed to delete agent:', error);
      throw error;
    }
  },

  selectAgent: (agent) => {
    set({ selectedAgent: agent });
  },

  updateAgentPosition: async (id, x, y) => {
    try {
      await agentApi.updatePosition(id, x, y);
      set((state) => ({
        agentNodes: state.agentNodes.map((n) =>
          n.id === id ? { ...n, position: { x, y } } : n
        ),
      }));
    } catch (error) {
      console.error('Failed to update position:', error);
    }
  },

  // Relation actions
  fetchRelations: async () => {
    set({ isLoadingRelations: true });
    try {
      const response = await relationApi.getAll();
      set({ relations: response.data.data });
    } catch (error) {
      console.error('Failed to fetch relations:', error);
    } finally {
      set({ isLoadingRelations: false });
    }
  },

  createRelation: async (data) => {
    try {
      const response = await relationApi.create(data);
      set((state) => ({
        relations: [...state.relations, response.data.data],
      }));
    } catch (error) {
      console.error('Failed to create relation:', error);
      throw error;
    }
  },

  updateRelation: async (id, data) => {
    try {
      const response = await relationApi.update(id, data);
      set((state) => ({
        relations: state.relations.map((r) => (r.id === id ? response.data.data : r)),
      }));
    } catch (error) {
      console.error('Failed to update relation:', error);
      throw error;
    }
  },

  deleteRelation: async (id) => {
    try {
      await relationApi.delete(id);
      set((state) => ({
        relations: state.relations.filter((r) => r.id !== id),
      }));
    } catch (error) {
      console.error('Failed to delete relation:', error);
      throw error;
    }
  },

  // Skill actions
  fetchSkills: async () => {
    set({ isLoadingSkills: true });
    try {
      const response = await skillApi.getAll();
      set({ skills: response.data.data });
    } catch (error) {
      console.error('Failed to fetch skills:', error);
    } finally {
      set({ isLoadingSkills: false });
    }
  },

  // Agent Private Skill actions
  fetchAgentPrivateSkills: async (agentId: string) => {
    set({ isLoadingPrivateSkills: true, selectedSkillAgentId: agentId });
    try {
      const response = await agentSkillApi.getAll(agentId);
      set({ agentPrivateSkills: response.data.data || [] });
    } catch (error) {
      console.error('Failed to fetch agent private skills:', error);
      set({ agentPrivateSkills: [] });
    } finally {
      set({ isLoadingPrivateSkills: false });
    }
  },

  installAgentSkill: async (agentId: string, data: Parameters<typeof agentSkillApi.install>[1]) => {
    try {
      const response = await agentSkillApi.install(agentId, data);
      // 刷新列表
      const listRes = await agentSkillApi.getAll(agentId);
      set({ agentPrivateSkills: listRes.data.data || [] });
      return response.data.data;
    } catch (error) {
      console.error('Failed to install agent skill:', error);
      throw error;
    }
  },

  uninstallAgentSkill: async (agentId: string, skillId: string) => {
    try {
      await agentSkillApi.uninstall(agentId, skillId);
      set((state) => ({
        agentPrivateSkills: state.agentPrivateSkills.filter((s) => s.skillId !== skillId),
      }));
    } catch (error) {
      console.error('Failed to uninstall agent skill:', error);
      throw error;
    }
  },

  toggleAgentSkill: async (agentId: string, skillId: string, enabled: boolean) => {
    try {
      await agentSkillApi.toggle(agentId, skillId, enabled);
      set((state) => ({
        agentPrivateSkills: state.agentPrivateSkills.map((s) =>
          s.skillId === skillId ? { ...s, enabled } : s
        ),
      }));
    } catch (error) {
      console.error('Failed to toggle agent skill:', error);
      throw error;
    }
  },

  setPersonaMode: async (agentId: string, skillId: string, mode: 'on' | 'off') => {
    try {
      await agentSkillApi.setPersonaMode(agentId, skillId, mode);
      set((state) => ({
        agentPrivateSkills: state.agentPrivateSkills.map((s) =>
          s.skillId === skillId ? { ...s, personaMode: mode } : s
        ),
      }));
    } catch (error) {
      console.error('Failed to set persona mode:', error);
      throw error;
    }
  },

  // Chat actions
  setCurrentChatAgent: (agent) => {
    set({ currentChatAgent: agent, chatMessages: [] });
  },

  setChatMessages: (messages) => {
    set({ chatMessages: messages });
  },

  addChatMessage: (message) => {
    set((state) => ({
      chatMessages: [...state.chatMessages, message],
    }));
  },
}));
