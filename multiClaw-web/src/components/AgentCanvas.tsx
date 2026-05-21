import { useState, useCallback, useEffect } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  Connection,
  Edge,
  Node,
  Panel,
  MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Button, Space, message, Modal } from 'antd';
import { 
  PlusOutlined, 
  SaveOutlined, 
  ReloadOutlined,
} from '@ant-design/icons';
import { useAppStore } from '../stores/appStore';
import { Agent, AgentRelation } from '../types';
import { relationApi } from '../services/api';
import AgentNodeComponent from './AgentNode';
import AgentFormModal from './AgentFormModal';
import RelationFormModal from './RelationFormModal';

const nodeTypes = {
  agentNode: AgentNodeComponent,
};

const getRelationColor = (type: string) => {
  switch (type) {
    case 'visible': return '#999';
    case 'trusted': return '#52c41a';
    case 'subordinate': return '#1677ff';
    case 'supervisor': return '#722ed1';
    default: return '#999';
  }
};

const getRelationLabel = (type: string, trustScore: number, collabCount: number) => {
  const base: Record<string, string> = {
    visible: '可见',
    trusted: '信任',
    subordinate: '下属',
    supervisor: '上级',
  };
  let label = base[type] || type;
  if (collabCount > 0) label += ` (${collabCount}次)`;
  if (trustScore > 0) label += ` ⭐${trustScore.toFixed(1)}`;
  return label;
};

export default function AgentCanvas() {
  const {
    agents,
    agentNodes,
    relations,
    skills,
    fetchAgents,
    fetchAgentNodes,
    fetchRelations,
    fetchSkills,
    createAgent,
    updateAgentPosition,
    deleteAgent,
    createRelation,
    setCurrentChatAgent,
  } = useAppStore();

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  
  const [agentModalVisible, setAgentModalVisible] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  
  const [relationModalVisible, setRelationModalVisible] = useState(false);
  const [editingRelation, setEditingRelation] = useState<AgentRelation | null>(null);
  const [connectingNodes, setConnectingNodes] = useState<{ source: Agent | null; target: Agent | null }>({
    source: null,
    target: null,
  });

  // Agent 操作回调
  const handleEditAgent = useCallback((agent: Agent) => {
    setEditingAgent(agent);
    setAgentModalVisible(true);
  }, []);

  const handleDeleteAgent = useCallback((agent: Agent) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除 Agent "${agent.name}" 吗？此操作不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        await deleteAgent(agent.id);
        message.success('Agent 已删除');
      },
    });
  }, [deleteAgent]);

  const handleChatWithAgent = useCallback((agent: Agent) => {
    setCurrentChatAgent(agent);
  }, [setCurrentChatAgent]);

  // 同步节点数据
  useEffect(() => {
    console.log('Syncing nodes, agents:', agents.length, 'agentNodes:', agentNodes.length);
    
    const flowNodes = agents.map((agent) => {
      const nodeInfo = agentNodes.find((n) => n.id === agent.id);
      const position = nodeInfo?.position || { 
        x: 100 + Math.random() * 300, 
        y: 100 + Math.random() * 200 
      };
      
      return {
        id: agent.id,
        type: 'agentNode' as const,
        position,
        data: {
          agent,
          onEdit: handleEditAgent,
          onDelete: handleDeleteAgent,
          onChat: handleChatWithAgent,
        },
      };
    });
    
    console.log('Setting flow nodes:', flowNodes.length);
    setNodes(flowNodes);
  }, [agents, agentNodes, handleEditAgent, handleDeleteAgent, handleChatWithAgent, setNodes]);

  // 同步边数据
  useEffect(() => {
    const flowEdges = relations.map((relation) => ({
      id: relation.id,
      source: relation.sourceId,
      target: relation.targetId,
      type: 'smoothstep' as const,
      animated: relation.relationType === 'trusted' || relation.relationType === 'subordinate',
      label: getRelationLabel(relation.relationType, relation.trustScore || 0, relation.collaborationCount || 0),
      markerEnd: {
        type: MarkerType.ArrowClosed,
      },
      style: {
        stroke: getRelationColor(relation.relationType),
        strokeWidth: 2,
      },
      data: { relation },
    }));
    setEdges(flowEdges);
  }, [relations, setEdges]);

  // 初始化数据
  useEffect(() => {
    fetchAgents();
    fetchAgentNodes();
    fetchRelations();
    fetchSkills();
  }, [fetchAgents, fetchAgentNodes, fetchRelations, fetchSkills]);

  // 处理节点连接
  const onConnect = useCallback(
    (connection: Connection) => {
      const sourceAgent = agents.find((a) => a.id === connection.source);
      const targetAgent = agents.find((a) => a.id === connection.target);
      
      if (sourceAgent && targetAgent) {
        setConnectingNodes({ source: sourceAgent, target: targetAgent });
        setEditingRelation(null);
        setRelationModalVisible(true);
      }
    },
    [agents]
  );

  // 处理边点击
  const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    const relation = edge.data?.relation as AgentRelation;
    if (relation) {
      setEditingRelation(relation);
      setConnectingNodes({ source: null, target: null });
      setRelationModalVisible(true);
    }
  }, []);

  // 处理节点拖拽结束
  const onNodeDragStop = useCallback(
    async (_: React.MouseEvent, node: Node) => {
      await updateAgentPosition(node.id, node.position.x, node.position.y);
    },
    [updateAgentPosition]
  );

  // Agent 操作
  const handleAddAgent = useCallback(() => {
    setEditingAgent(null);
    setAgentModalVisible(true);
  }, []);

  const handleAgentSubmit = useCallback(async (values: any) => {
    try {
      if (editingAgent) {
        await useAppStore.getState().updateAgent(editingAgent.id, values);
      } else {
        await createAgent(values);
        setTimeout(async () => {
          await fetchAgents();
          await fetchAgentNodes();
        }, 100);
      }
    } catch (error) {
      console.error('Failed to submit agent:', error);
      throw error;
    }
  }, [editingAgent, createAgent, fetchAgents, fetchAgentNodes]);

  // Relation 操作
  const handleRelationSubmit = useCallback(async (values: any) => {
    if (editingRelation) {
      await useAppStore.getState().updateRelation(editingRelation.id, values);
    } else {
      await createRelation(values);
    }
  }, [editingRelation, createRelation]);

  const handleApplyRelations = useCallback(async () => {
    try {
      await relationApi.apply();
      message.success('关系规则已应用到 OpenClaw');
    } catch (error) {
      message.error('应用失败');
    }
  }, []);

  const handleRefresh = useCallback(() => {
    fetchAgents();
    fetchAgentNodes();
    fetchRelations();
    message.success('数据已刷新');
  }, [fetchAgents, fetchAgentNodes, fetchRelations]);

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onEdgeClick={onEdgeClick}
        onNodeDragStop={onNodeDragStop}
        nodeTypes={nodeTypes}
        fitView
        attributionPosition="bottom-left"
      >
        <Background color="#aaa" gap={16} />
        <Controls />
        <MiniMap
          nodeStrokeWidth={3}
          zoomable
          pannable
        />
        
        <Panel position="top-left">
          <Space>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleAddAgent}
            >
              新建 Agent
            </Button>
            <Button
              icon={<SaveOutlined />}
              onClick={handleApplyRelations}
            >
              应用关系到 OpenClaw
            </Button>
            <Button
              icon={<ReloadOutlined />}
              onClick={handleRefresh}
            >
              刷新
            </Button>
          </Space>
        </Panel>

        <Panel position="top-right">
          <div className="bg-white p-3 rounded shadow">
            <h4 className="font-semibold mb-2">关系图例</h4>
            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-6 h-0.5" style={{ backgroundColor: '#999' }}></div>
                <span>可见</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-0.5" style={{ backgroundColor: '#52c41a' }}></div>
                <span>信任</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-0.5" style={{ backgroundColor: '#1677ff' }}></div>
                <span>下属</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-0.5" style={{ backgroundColor: '#722ed1' }}></div>
                <span>上级</span>
              </div>
            </div>
          </div>
        </Panel>
      </ReactFlow>

      <AgentFormModal
        visible={agentModalVisible}
        agent={editingAgent}
        skills={skills}
        onCancel={() => setAgentModalVisible(false)}
        onSubmit={handleAgentSubmit}
      />

      <RelationFormModal
        visible={relationModalVisible}
        relation={editingRelation}
        agents={agents}
        sourceAgent={connectingNodes.source}
        targetAgent={connectingNodes.target}
        onCancel={() => {
          setRelationModalVisible(false);
          setConnectingNodes({ source: null, target: null });
        }}
        onSubmit={handleRelationSubmit}
      />
    </div>
  );
}