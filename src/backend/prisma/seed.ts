import { PrismaClient, UserRole, UserType, TaskStatus, Priority, Category } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Clean up existing data
  await prisma.taskHistory.deleteMany();
  await prisma.checklistItem.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.extractedTask.deleteMany();
  await prisma.inboxItem.deleteMany();
  await prisma.goal.deleteMany();
  await prisma.report.deleteMany();
  await prisma.task.deleteMany();
  await prisma.projectMember.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();

  const saltRounds = 10;

  // Create admin user
  const adminPassword = await bcrypt.hash('admin123', saltRounds);
  const admin = await prisma.user.create({
    data: {
      email: 'admin@techtcb.local',
      password: adminPassword,
      name: 'Администратор',
      role: UserRole.ADMIN,
      type: UserType.HUMAN,
    },
  });
  console.log('Created admin:', admin.email);

  // Create manager user
  const managerPassword = await bcrypt.hash('manager123', saltRounds);
  const manager = await prisma.user.create({
    data: {
      email: 'manager@techtcb.local',
      password: managerPassword,
      name: 'Иванов Директор',
      role: UserRole.MANAGER,
      type: UserType.HUMAN,
      managerId: null,
    },
  });
  console.log('Created manager:', manager.email);

  // Create employee users
  const employeePassword = await bcrypt.hash('employee123', saltRounds);

  const melnikov = await prisma.user.create({
    data: {
      email: 'melnikov@techtcb.local',
      password: employeePassword,
      name: 'Мельников',
      role: UserRole.EMPLOYEE,
      type: UserType.HUMAN,
      managerId: manager.id,
    },
  });

  const anisimov = await prisma.user.create({
    data: {
      email: 'anisimov@techtcb.local',
      password: employeePassword,
      name: 'Анисимов',
      role: UserRole.EMPLOYEE,
      type: UserType.HUMAN,
      managerId: manager.id,
    },
  });

  const vanya = await prisma.user.create({
    data: {
      email: 'vanya@techtcb.local',
      password: employeePassword,
      name: 'Ваня',
      role: UserRole.EMPLOYEE,
      type: UserType.HUMAN,
      managerId: manager.id,
    },
  });

  const lesha = await prisma.user.create({
    data: {
      email: 'lesha@techtcb.local',
      password: employeePassword,
      name: 'Лёша',
      role: UserRole.EMPLOYEE,
      type: UserType.HUMAN,
      managerId: manager.id,
    },
  });

  const diana = await prisma.user.create({
    data: {
      email: 'diana@techtcb.local',
      password: employeePassword,
      name: 'Диана',
      role: UserRole.EMPLOYEE,
      type: UserType.HUMAN,
      managerId: manager.id,
    },
  });

  console.log('Created employees:', melnikov.email, anisimov.email, vanya.email, lesha.email, diana.email);

  // Create AI agent user
  const coderAgent = await prisma.user.create({
    data: {
      email: 'coder-agent@techtcb.local',
      name: 'Coder AI Agent',
      role: UserRole.AI_AGENT,
      type: UserType.AI_AGENT,
      apiToken: 'dev-api-token-coder',
    },
  });
  console.log('Created AI agent:', coderAgent.email);

  // Create projects for each employee
  const employees = [melnikov, anisimov, vanya, lesha, diana];
  const projectNames = [
    'Проект Мельникова',
    'Проект Анисимова',
    'Проект Вани',
    'Проект Лёши',
    'Проект Дианы',
  ];

  for (let i = 0; i < employees.length; i++) {
    const employee = employees[i];
    const projectName = projectNames[i];

    const project = await prisma.project.create({
      data: {
        name: projectName,
        description: `Рабочий проект сотрудника ${employee.name}`,
        ownerId: employee.id,
        members: {
          create: [
            { userId: employee.id },
            { userId: manager.id },
          ],
        },
      },
    });

    console.log('Created project:', project.name);

    // Create sample tasks for each project
    const task1 = await prisma.task.create({
      data: {
        title: 'Провести анализ требований',
        description: 'Изучить и задокументировать требования к проекту',
        projectId: project.id,
        assigneeId: employee.id,
        creatorId: manager.id,
        status: TaskStatus.TODO,
        priority: Priority.HIGH,
        category: Category.CHANGE,
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        labels: ['analysis', 'planning'],
      },
    });

    const task2 = await prisma.task.create({
      data: {
        title: 'Подготовить отчет о проделанной работе',
        description: 'Составить еженедельный отчет с результатами работы',
        projectId: project.id,
        assigneeId: employee.id,
        creatorId: manager.id,
        status: TaskStatus.IN_PROGRESS,
        priority: Priority.MEDIUM,
        category: Category.RUN,
        dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        labels: ['report'],
      },
    });

    const task3 = await prisma.task.create({
      data: {
        title: 'Обновить документацию',
        description: 'Актуализировать техническую документацию по проекту',
        projectId: project.id,
        assigneeId: employee.id,
        creatorId: employee.id,
        status: TaskStatus.BACKLOG,
        priority: Priority.LOW,
        category: Category.RUN,
        labels: ['docs'],
      },
    });

    const task4 = await prisma.task.create({
      data: {
        title: 'Провести тестирование',
        description: 'Написать и выполнить тесты для основного функционала',
        projectId: project.id,
        assigneeId: employee.id,
        creatorId: manager.id,
        status: TaskStatus.DONE,
        priority: Priority.HIGH,
        category: Category.CHANGE,
        completedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        labels: ['testing', 'qa'],
      },
    });

    // Add checklist to task1
    await prisma.checklistItem.createMany({
      data: [
        { taskId: task1.id, title: 'Собрать требования от стейкхолдеров', completed: true },
        { taskId: task1.id, title: 'Проанализировать конкурентов', completed: false },
        { taskId: task1.id, title: 'Составить спецификацию', completed: false },
      ],
    });

    // Add task history
    await prisma.taskHistory.createMany({
      data: [
        {
          taskId: task2.id,
          userId: employee.id,
          action: 'STATUS_CHANGED',
          oldValue: 'TODO',
          newValue: 'IN_PROGRESS',
        },
        {
          taskId: task4.id,
          userId: employee.id,
          action: 'STATUS_CHANGED',
          oldValue: 'REVIEW',
          newValue: 'DONE',
        },
      ],
    });

    console.log('Created tasks for project:', project.name, [task1.id, task2.id, task3.id, task4.id]);
  }

  console.log('Seeding complete!');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
